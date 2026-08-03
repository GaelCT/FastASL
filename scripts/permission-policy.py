#!/usr/bin/env python3
"""H-13 authoritative POSIX tree and release ZIP permission validator."""
from __future__ import annotations

import argparse
import json
import os
import shutil
import stat
import sys
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

SCRIPT = Path(__file__).resolve()
POLICY_PATH = SCRIPT.with_name('permission-policy.json')


def load_policy():
    return json.loads(POLICY_PATH.read_text(encoding='utf-8'))


def mode(path: Path) -> int:
    return stat.S_IMODE(path.lstat().st_mode)


def fail(errors: list[str], path: str, value: int | None, rule: str):
    rendered = 'missing' if value is None else format(value, '04o')
    errors.append(f'FAIL: {path} ({rendered}): {rule}')


def assert_failure(errors: list[str], *, expected_path: str, expected_rule: str) -> None:
    assert errors, f'{expected_path}: fixture unexpectedly passed'
    assert any(expected_path in error and expected_rule in error for error in errors), (
        f'expected {expected_path!r} / {expected_rule!r}; received: {errors}'
    )


def source_paths(root: Path, policy):
    for rel in policy['source_roots']:
        candidate = root / rel
        if candidate.exists():
            yield candidate
            yield from candidate.rglob('*')
    for rel in policy['source_root_files']:
        candidate = root / rel
        if candidate.exists():
            yield candidate


def validate_tree(root: Path, policy=None, require_runtime=False) -> list[str]:
    policy = policy or load_policy()
    errors: list[str] = []
    for path in source_paths(root, policy):
        relative = path.relative_to(root).as_posix()
        details = path.lstat()
        if stat.S_ISLNK(details.st_mode):
            fail(errors, relative, mode(path), 'symlinks are not permitted in source roots')
            continue
        current = stat.S_IMODE(details.st_mode)
        if current & 0o022:
            kind = 'directory' if path.is_dir() else 'file'
            fail(errors, relative, current, f'source {kind} grants group/world write (mode & 0022)')

    for secret in policy['secret_files']:
        path = root / secret
        if path.exists() and mode(path) not in (0o400, 0o600):
            fail(errors, secret, mode(path), 'secret must be exactly 0400 or 0600')

    runtime_root = root / policy['runtime_root']
    if require_runtime and not runtime_root.is_dir():
        fail(errors, policy['runtime_root'], None, 'required runtime root is absent')
    if runtime_root.exists():
        allowed_dirs = set(policy['runtime_writable_directories'])
        allowed_file_parents = set(policy['runtime_writable_file_parents'])
        for path in [runtime_root, *runtime_root.rglob('*')]:
            relative = path.relative_to(root).as_posix()
            current = mode(path)
            if current & 0o002:
                fail(errors, relative, current, 'runtime path is world-writable')
                continue
            if current & 0o020:
                fail(errors, relative, current, 'runtime path grants group write; owner-only writes are required')
                continue
            if path.is_dir() and current & 0o200 and relative not in allowed_dirs:
                fail(errors, relative, current, 'unexpected runtime directory is writable')
            if path.is_file() and current & 0o200 and path.parent.relative_to(root).as_posix() not in allowed_file_parents:
                fail(errors, relative, current, 'unexpected runtime file is writable')
    return errors


def print_errors(errors: list[str]) -> int:
    for error in errors:
        print(error, file=sys.stderr)
    return 1 if errors else 0


def archive_members(root: Path, policy):
    for rel in policy['release_roots']:
        candidate = root / rel
        if candidate.is_dir():
            yield candidate
            yield from candidate.rglob('*')
    for rel in policy['release_root_files']:
        candidate = root / rel
        if candidate.is_file():
            yield candidate


def zip_info(name: str, path: Path, is_dir: bool):
    entry = zipfile.ZipInfo(name + ('/' if is_dir else ''))
    entry.create_system = 3
    permissions = 0o755 if is_dir or os.access(path, os.X_OK) else 0o644
    entry.external_attr = ((stat.S_IFDIR if is_dir else stat.S_IFREG) | permissions) << 16
    return entry


def build_release(root: Path, output: Path):
    policy = load_policy()
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for path in archive_members(root, policy):
            relative = path.relative_to(root).as_posix()
            if any(relative == excluded or relative.startswith(excluded + '/') for excluded in policy['release_excluded']):
                continue
            if path.is_symlink():
                raise RuntimeError(f'release source contains symlink: {relative}')
            archive.writestr(zip_info(relative, path, path.is_dir()), b'' if path.is_dir() else path.read_bytes())
    errors = validate_zip(output)
    if errors:
        raise RuntimeError('production release ZIP is incomplete or unsafe: ' + '; '.join(errors))
    print(output)


def normalized_name(raw: str) -> str | None:
    if not raw or '\x00' in raw or '\\' in raw or raw.startswith('/'):
        return None
    directory = raw.endswith('/')
    name = raw[:-1] if directory else raw
    if not name or len(name) > 1 and name[1] == ':':
        return None
    pure = PurePosixPath(name)
    if pure.is_absolute() or any(part in ('', '.', '..') for part in pure.parts):
        return None
    canonical = pure.as_posix()
    if raw != canonical + ('/' if directory else ''):
        return None
    return canonical


def safe_target(destination: Path, raw_name: str) -> Path | None:
    name = normalized_name(raw_name)
    if name is None:
        return None
    destination_resolved = destination.resolve()
    target = destination / PurePosixPath(name)
    target_resolved = target.resolve(strict=False)
    try:
        contained = os.path.commonpath([str(destination_resolved), str(target_resolved)]) == str(destination_resolved)
    except ValueError:
        contained = False
    return target if contained else None


def required_type(policy, name: str) -> int:
    return stat.S_IFDIR if name in policy['release_roots'] else stat.S_IFREG


def validate_zip(archive_path: Path) -> list[str]:
    policy = load_policy()
    errors: list[str] = []
    entries: dict[str, tuple[zipfile.ZipInfo, int]] = {}
    with zipfile.ZipFile(archive_path) as archive:
        if not archive.infolist():
            fail(errors, str(archive_path), None, 'release ZIP contains no entries')
        for entry in archive.infolist():
            name = normalized_name(entry.filename)
            if name is None:
                fail(errors, entry.filename, None, 'archive path is unsafe')
                continue
            if name in entries:
                fail(errors, name, None, 'duplicate normalized archive entry name')
                continue
            stored = (entry.external_attr >> 16) & 0xffff
            permissions = stored & 0o777
            file_type = stat.S_IFMT(stored)
            entries[name] = (entry, file_type)
            if entry.create_system != 3 or not permissions:
                fail(errors, entry.filename, permissions, 'ZIP entry lacks usable Unix mode metadata')
                continue
            if not file_type:
                fail(errors, entry.filename, permissions, 'ZIP entry lacks Unix file type metadata')
                continue
            if file_type == stat.S_IFLNK:
                fail(errors, entry.filename, permissions, 'archive symlink is prohibited')
                continue
            if file_type not in (stat.S_IFREG, stat.S_IFDIR):
                fail(errors, entry.filename, permissions, 'ZIP entry has an unsupported Unix file type')
                continue
            if file_type == stat.S_IFDIR and not entry.filename.endswith('/'):
                fail(errors, entry.filename, permissions, 'stored directory type lacks directory naming semantics')
                continue
            if file_type == stat.S_IFREG and entry.filename.endswith('/'):
                fail(errors, entry.filename, permissions, 'stored regular file type has directory naming semantics')
                continue
            if permissions & 0o022:
                fail(errors, entry.filename, permissions, 'stored source mode grants group/world write')
        for name in policy['release_required_entries']:
            present = entries.get(name)
            expected = required_type(policy, name)
            if present is None:
                kind = 'directory' if expected == stat.S_IFDIR else 'file'
                fail(errors, name, None, f'required release {kind} is absent')
            elif present[1] != expected:
                actual = 'directory' if present[1] == stat.S_IFDIR else 'regular file'
                expected_label = 'directory' if expected == stat.S_IFDIR else 'file'
                fail(errors, name, (present[0].external_attr >> 16) & 0o777, f'required {expected_label} is stored as a {actual}')
        for secret in policy['secret_files']:
            if secret in entries:
                fail(errors, secret, None, 'secret must be excluded from release ZIP')
    return errors


def validate_extracted_release(destination: Path, policy=None) -> list[str]:
    policy = policy or load_policy()
    errors: list[str] = []
    for name in policy['release_required_entries']:
        path = destination / PurePosixPath(name)
        expected = required_type(policy, name)
        if not path.exists():
            kind = 'directory' if expected == stat.S_IFDIR else 'file'
            fail(errors, name, None, f'extracted required release {kind} is absent')
        elif expected == stat.S_IFDIR and not path.is_dir():
            fail(errors, name, mode(path), 'extracted required directory is not a directory')
        elif expected == stat.S_IFREG and not path.is_file():
            fail(errors, name, mode(path), 'extracted required file is not a file')
    return errors + validate_tree(destination, policy, require_runtime=False)


def extract_and_validate(archive_path: Path, destination: Path) -> list[str]:
    errors = validate_zip(archive_path)
    if errors:
        return errors
    with zipfile.ZipFile(archive_path) as archive:
        for entry in archive.infolist():
            target = safe_target(destination, entry.filename)
            if target is None:
                fail(errors, entry.filename, None, 'archive path is unsafe during extraction')
                continue
            stored = (entry.external_attr >> 16) & 0xffff
            file_type = stat.S_IFMT(stored)
            if file_type == stat.S_IFDIR:
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.read(entry))
            os.chmod(target, stored & 0o777)
    return errors + validate_extracted_release(destination)


def explicit_destination(requested: Path) -> Path:
    """Create a new destination without following caller-owned path entries."""
    lexical = requested.absolute()
    if os.path.lexists(lexical):
        raise FileExistsError(f'destination already exists and is caller-owned: {lexical}')
    lexical_parent = lexical.parent
    if lexical_parent.is_symlink():
        raise OSError(f'destination parent is a symlink and is caller-owned: {lexical_parent}')
    try:
        parent = lexical_parent.resolve(strict=True)
    except FileNotFoundError as exc:
        raise FileNotFoundError(f'destination parent does not exist: {lexical_parent}') from exc
    if not parent.is_dir():
        raise NotADirectoryError(f'destination parent is not a directory: {parent}')
    destination = parent / lexical.name
    destination.mkdir(exist_ok=False)
    details = destination.lstat()
    if not stat.S_ISDIR(details.st_mode) or stat.S_ISLNK(details.st_mode):
        raise RuntimeError(f'created destination is not a real directory: {destination}')
    return destination


def managed_extract_validate(archive_path: Path, requested: Path | None) -> list[str]:
    destination_created = False
    if requested is None:
        destination = Path(tempfile.mkdtemp(prefix='fastasl-release-'))
        destination_created = True
    else:
        try:
            destination = explicit_destination(requested)
        except FileExistsError:
            return [f'FAIL: {requested.absolute()} (existing): destination already exists and is caller-owned']
        except OSError as exc:
            return [f'FAIL: {requested.absolute()} (missing): cannot prepare destination: {exc}']
        destination_created = True
    errors: list[str] = []
    try:
        errors = extract_and_validate(archive_path, destination)
    finally:
        if destination_created:
            try:
                shutil.rmtree(destination, ignore_errors=False)
            except OSError as exc:
                errors.append(f'FAIL: {destination} (cleanup): validator-owned destination cleanup failed: {exc}')
    return errors


def fixture_tree(root: Path, policy):
    for rel in policy['source_roots']:
        (root / rel).mkdir(parents=True, exist_ok=True)
        os.chmod(root / rel, 0o755)
    for rel in policy['runtime_writable_directories']:
        (root / rel).mkdir(parents=True, exist_ok=True)
        os.chmod(root / rel, 0o750)
    for rel in policy['source_root_files']:
        path = root / rel
        path.write_text('fixture\n', encoding='utf-8')
        os.chmod(path, 0o644)
    for rel in policy['release_required_entries']:
        if required_type(policy, rel) == stat.S_IFREG:
            path = root / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('fixture\n', encoding='utf-8')
            os.chmod(path, 0o644)
    source = root / 'backend/nested.php'
    source.write_text('<?php\n', encoding='utf-8')
    os.chmod(source, 0o644)
    secret = root / '.env'
    secret.write_text('SECRET=x\n', encoding='utf-8')
    os.chmod(secret, 0o400)


def rewrite_zip(source: Path, output: Path, mutate):
    with zipfile.ZipFile(source) as original, zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as rewritten:
        for entry in original.infolist():
            data = original.read(entry) if not entry.is_dir() else b''
            replacement = zipfile.ZipInfo(entry.filename)
            replacement.create_system = entry.create_system
            replacement.external_attr = entry.external_attr
            replacement = mutate(replacement, data)
            if replacement is not None:
                rewritten.writestr(replacement, data)


def self_test():
    if os.name != 'posix':
        raise RuntimeError('POSIX permission self-test requires the supported Linux CI/container environment')
    policy = load_policy()
    with tempfile.TemporaryDirectory() as raw:
        base = Path(raw)
        root = base / 'release-source'
        root.mkdir()
        fixture_tree(root, policy)
        assert not validate_tree(root, policy), 'safe source tree failed'
        for value in (0o664, 0o666):
            os.chmod(root / 'backend/nested.php', value)
            assert_failure(validate_tree(root, policy), expected_path='backend/nested.php', expected_rule='source file grants group/world write')
        os.chmod(root / 'backend/nested.php', 0o644)
        for value in (0o775, 0o777):
            path = root / 'backend/unsafe-dir'; path.mkdir(exist_ok=True); os.chmod(path, value)
            assert_failure(validate_tree(root, policy), expected_path='backend/unsafe-dir', expected_rule='source directory grants group/world write')
            os.chmod(path, 0o755); path.rmdir()
        os.chmod(root / '.env', 0o644)
        assert_failure(validate_tree(root, policy), expected_path='.env', expected_rule='secret must be exactly 0400 or 0600')
        for value in (0o400, 0o600):
            os.chmod(root / '.env', value)
            assert not validate_tree(root, policy), f'secret {value:04o} did not pass'
        bad_dir = root / 'var/unexpected'; bad_dir.mkdir(); os.chmod(bad_dir, 0o750)
        assert_failure(validate_tree(root, policy), expected_path='var/unexpected', expected_rule='unexpected runtime directory is writable')
        os.chmod(bad_dir, 0o755); bad_dir.rmdir()
        bad_file = root / 'var/unexpected.log'; bad_file.write_text('x'); os.chmod(bad_file, 0o600)
        assert_failure(validate_tree(root, policy), expected_path='var/unexpected.log', expected_rule='unexpected runtime file is writable')
        os.chmod(bad_file, 0o400); bad_file.unlink()
        world = root / 'var/cache/world'; world.write_text('x'); os.chmod(world, 0o666)
        assert_failure(validate_tree(root, policy), expected_path='var/cache/world', expected_rule='runtime path is world-writable')
        os.chmod(world, 0o400); world.unlink()

        valid = base / 'valid.zip'; build_release(root, valid); assert not validate_zip(valid), 'valid ZIP failed'
        for value in (0o664, 0o666):
            target = base / f'file-{value:o}.zip'
            rewrite_zip(valid, target, lambda item, data, value=value: (setattr(item, 'external_attr', (stat.S_IFREG | value) << 16) or item) if item.filename == 'backend/nested.php' else item)
            assert_failure(validate_zip(target), expected_path='backend/nested.php', expected_rule='stored source mode grants group/world write')
        for value in (0o775, 0o777):
            target = base / f'dir-{value:o}.zip'
            rewrite_zip(valid, target, lambda item, data, value=value: (setattr(item, 'external_attr', (stat.S_IFDIR | value) << 16) or item) if item.filename == 'backend/' else item)
            assert_failure(validate_zip(target), expected_path='backend/', expected_rule='stored source mode grants group/world write')
        mutations = [
            ('missing-mode', 'backend/nested.php', 'ZIP entry lacks usable Unix mode metadata', lambda item: (setattr(item, 'create_system', 0) or setattr(item, 'external_attr', 0) or item)),
            ('zero-mode', 'backend/nested.php', 'ZIP entry lacks usable Unix mode metadata', lambda item: (setattr(item, 'external_attr', stat.S_IFREG << 16) or item)),
            ('missing-type', 'backend/nested.php', 'ZIP entry lacks Unix file type metadata', lambda item: (setattr(item, 'external_attr', 0o644 << 16) or item)),
            ('symlink', 'backend/nested.php', 'archive symlink is prohibited', lambda item: (setattr(item, 'external_attr', (stat.S_IFLNK | 0o777) << 16) or item)),
            ('special', 'backend/nested.php', 'unsupported Unix file type', lambda item: (setattr(item, 'external_attr', (stat.S_IFIFO | 0o644) << 16) or item)),
        ]
        for label, path, rule, mutation in mutations:
            target = base / f'{label}.zip'
            rewrite_zip(valid, target, lambda item, data, mutation=mutation: mutation(item) if item.filename == 'backend/nested.php' else item)
            assert_failure(validate_zip(target), expected_path=path, expected_rule=rule)
        mismatch = base / 'regular-directory-name.zip'
        rewrite_zip(valid, mismatch, lambda item, data: (setattr(item, 'external_attr', (stat.S_IFREG | 0o644) << 16) or item) if item.filename == 'backend/' else item)
        errors = validate_zip(mismatch)
        assert_failure(errors, expected_path='backend/', expected_rule='stored regular file type has directory naming semantics')
        assert_failure(errors, expected_path='backend', expected_rule='required directory is stored as a regular file')
        mismatch = base / 'directory-file-name.zip'
        rewrite_zip(valid, mismatch, lambda item, data: (setattr(item, 'filename', 'backend') or item) if item.filename == 'backend/' else item)
        assert_failure(validate_zip(mismatch), expected_path='backend', expected_rule='stored directory type lacks directory naming semantics')
        mismatch = base / 'required-file-directory.zip'
        rewrite_zip(valid, mismatch, lambda item, data: (setattr(item, 'filename', 'README.md/') or setattr(item, 'external_attr', (stat.S_IFDIR | 0o755) << 16) or item) if item.filename == 'README.md' else item)
        assert_failure(validate_zip(mismatch), expected_path='README.md', expected_rule='required file is stored as a directory')
        with zipfile.ZipFile(base / 'empty.zip', 'w'):
            pass
        assert_failure(validate_zip(base / 'empty.zip'), expected_path='empty.zip', expected_rule='release ZIP contains no entries')
        missing = base / 'missing-required.zip'
        rewrite_zip(valid, missing, lambda item, data: None if item.filename == 'README.md' else item)
        assert_failure(validate_zip(missing), expected_path='README.md', expected_rule='required release file is absent')
        duplicate = base / 'duplicate-name.zip'
        rewrite_zip(valid, duplicate, lambda item, data: item)
        with zipfile.ZipFile(duplicate, 'a') as archive:
            item = zipfile.ZipInfo('README.md'); item.create_system = 3; item.external_attr = (stat.S_IFREG | 0o644) << 16; archive.writestr(item, b'duplicate')
        assert_failure(validate_zip(duplicate), expected_path='README.md', expected_rule='duplicate normalized archive entry name')
        secret = base / 'secret.zip'
        rewrite_zip(valid, secret, lambda item, data: item)
        with zipfile.ZipFile(secret, 'a') as archive:
            item = zipfile.ZipInfo('.env'); item.create_system = 3; item.external_attr = (stat.S_IFREG | 0o600) << 16; archive.writestr(item, b'SECRET=x')
        assert_failure(validate_zip(secret), expected_path='.env', expected_rule='secret must be excluded from release ZIP')
        for raw_name in ('../escape', '..\\escape', '/absolute/path', 'C:/escape', 'C:\\escape', 'nested/../../escape'):
            unsafe = base / ('unsafe-' + str(abs(hash(raw_name))) + '.zip')
            rewrite_zip(valid, unsafe, lambda item, data: item)
            with zipfile.ZipFile(unsafe, 'a') as archive:
                item = zipfile.ZipInfo(raw_name); item.create_system = 3; item.external_attr = (stat.S_IFREG | 0o644) << 16; archive.writestr(item, b'x')
            assert_failure(validate_zip(unsafe), expected_path=raw_name, expected_rule='archive path is unsafe')
        destination = base / 'extracted'; destination.mkdir()
        assert not extract_and_validate(valid, destination), 'valid extracted tree failed'
        os.chmod(destination / 'backend/nested.php', 0o666)
        assert_failure(validate_extracted_release(destination), expected_path='backend/nested.php', expected_rule='source file grants group/world write')
        shutil.rmtree(destination)

        before = set(Path(tempfile.gettempdir()).glob('fastasl-release-*'))
        assert not managed_extract_validate(valid, None), 'default extraction failed'
        assert set(Path(tempfile.gettempdir()).glob('fastasl-release-*')) == before, 'default extraction leaked a directory'
        explicit = base / 'owned-output'
        assert not managed_extract_validate(valid, explicit), 'explicit extraction failed'
        assert not explicit.exists(), 'explicit validator-owned destination was not cleaned'

        empty_existing = base / 'existing-empty'; empty_existing.mkdir()
        assert_failure(managed_extract_validate(valid, empty_existing), expected_path='existing-empty', expected_rule='caller-owned')
        assert empty_existing.exists(), 'existing empty destination was deleted'
        sentinel_dir = base / 'existing-sentinel'; sentinel_dir.mkdir(); sentinel = sentinel_dir / 'sentinel.txt'; sentinel.write_text('preserve')
        assert_failure(managed_extract_validate(valid, sentinel_dir), expected_path='existing-sentinel', expected_rule='caller-owned')
        assert sentinel.read_text() == 'preserve', 'sentinel content changed'
        existing_file = base / 'existing-file'; existing_file.write_text('preserve')
        assert_failure(managed_extract_validate(valid, existing_file), expected_path='existing-file', expected_rule='caller-owned')
        assert existing_file.read_text() == 'preserve', 'existing destination file changed'

        directory_target = base / 'directory-target'; directory_target.mkdir(); directory_sentinel = directory_target / 'sentinel.txt'; directory_sentinel.write_text('preserve')
        directory_link = base / 'directory-link'; directory_link.symlink_to(directory_target, target_is_directory=True)
        assert_failure(managed_extract_validate(valid, directory_link), expected_path='directory-link', expected_rule='caller-owned')
        assert os.path.lexists(directory_link) and os.readlink(directory_link) == str(directory_target), 'directory symlink changed'
        assert directory_sentinel.read_text() == 'preserve' and not (directory_target / 'backend').exists(), 'directory symlink target changed'
        file_target = base / 'file-target'; file_target.write_text('preserve')
        file_link = base / 'file-link'; file_link.symlink_to(file_target)
        assert_failure(managed_extract_validate(valid, file_link), expected_path='file-link', expected_rule='caller-owned')
        assert os.path.lexists(file_link) and os.readlink(file_link) == str(file_target), 'file symlink changed'
        assert file_target.read_text() == 'preserve', 'file symlink target changed'
        dangling_target = base / 'outside-target'
        dangling_link = base / 'destination-link'; dangling_link.symlink_to(dangling_target, target_is_directory=True)
        assert os.path.lexists(dangling_link) and not dangling_target.exists(), 'dangling fixture setup failed'
        assert_failure(managed_extract_validate(valid, dangling_link), expected_path='destination-link', expected_rule='caller-owned')
        assert os.path.lexists(dangling_link) and os.readlink(dangling_link) == str(dangling_target), 'dangling symlink changed'
        assert not dangling_target.exists(), 'dangling symlink target was created'

        invalid_destination = base / 'failed-output'
        assert_failure(managed_extract_validate(base / 'empty.zip', invalid_destination), expected_path='empty.zip', expected_rule='release ZIP contains no entries')
        assert not invalid_destination.exists(), 'failed validation leaked validator-owned destination'
        missing_parent = base / 'missing-parent'
        assert_failure(managed_extract_validate(valid, missing_parent / 'child'), expected_path='child', expected_rule='destination parent does not exist')
        assert not missing_parent.exists(), 'missing parent chain was created'
        parent_file = base / 'parent-file'; parent_file.write_text('preserve')
        assert_failure(managed_extract_validate(valid, parent_file / 'child'), expected_path='child', expected_rule='destination parent is not a directory')
        assert parent_file.read_text() == 'preserve', 'destination creation failure modified parent'
        parent_target = base / 'real-parent'; parent_target.mkdir(); parent_sentinel = parent_target / 'sentinel.txt'; parent_sentinel.write_text('preserve')
        parent_link = base / 'parent-link'; parent_link.symlink_to(parent_target, target_is_directory=True)
        assert_failure(managed_extract_validate(valid, parent_link / 'child'), expected_path='child', expected_rule='destination parent is a symlink')
        assert os.path.lexists(parent_link) and os.readlink(parent_link) == str(parent_target), 'parent symlink changed'
        assert parent_sentinel.read_text() == 'preserve' and not (parent_target / 'child').exists(), 'parent symlink target changed'
    print('OK: exact POSIX, ZIP, extraction, and destination-ownership fixtures passed.')


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest='command', required=True)
    for command in ('validate-tree', 'build-release', 'validate-zip', 'extract-validate'):
        item = sub.add_parser(command)
        item.add_argument('--root', type=Path, default=Path.cwd())
        item.add_argument('--zip', type=Path)
        item.add_argument('--output', type=Path)
        item.add_argument('--destination', type=Path)
    sub.add_parser('self-test')
    args = parser.parse_args()
    if args.command == 'self-test':
        self_test(); return 0
    if args.command == 'validate-tree':
        return print_errors(validate_tree(args.root.resolve(), require_runtime=False))
    if args.command == 'build-release':
        build_release(args.root.resolve(), args.output or args.root / 'dist/fastasl-release.zip'); return 0
    if args.command == 'validate-zip':
        return print_errors(validate_zip(args.zip))
    if args.command == 'extract-validate':
        return print_errors(managed_extract_validate(args.zip, args.destination))


if __name__ == '__main__':
    sys.exit(main())
