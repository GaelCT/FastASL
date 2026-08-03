#!/usr/bin/env python3
"""H-13 authoritative POSIX tree and release ZIP permission validator."""
from __future__ import annotations
import argparse, json, os, shutil, stat, sys, tempfile, zipfile
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
        if path.exists():
            current = mode(path)
            if current not in (0o400, 0o600):
                fail(errors, secret, current, 'secret must be exactly 0400 or 0600')

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
            owner_writable = bool(current & 0o200)
            if path.is_dir() and owner_writable and relative not in allowed_dirs:
                fail(errors, relative, current, 'unexpected runtime directory is writable')
            if path.is_file() and owner_writable and path.parent.relative_to(root).as_posix() not in allowed_file_parents:
                fail(errors, relative, current, 'unexpected runtime file is writable')
            if current & 0o020:
                fail(errors, relative, current, 'runtime path grants group write; owner-only writes are required')
    return errors


def print_errors(errors):
    for error in errors:
        print(error, file=sys.stderr)
    return 1 if errors else 0


def archive_members(root: Path, policy):
    excluded = set(policy['release_excluded'])
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
            info = zip_info(relative, path, path.is_dir())
            archive.writestr(info, b'' if path.is_dir() else path.read_bytes())
    print(output)


def safe_member(name: str) -> bool:
    pure = PurePosixPath(name)
    return not pure.is_absolute() and '..' not in pure.parts and not (len(name) > 1 and name[1] == ':')


def validate_zip(archive_path: Path) -> list[str]:
    policy = load_policy()
    errors: list[str] = []
    with zipfile.ZipFile(archive_path) as archive:
        names = set()
        for entry in archive.infolist():
            name = entry.filename.rstrip('/')
            if not name:
                continue
            names.add(name)
            if not safe_member(entry.filename):
                fail(errors, entry.filename, None, 'archive path is unsafe')
                continue
            stored = (entry.external_attr >> 16) & 0xffff
            permission_bits = stored & 0o777
            file_type = stat.S_IFMT(stored)
            if entry.create_system != 3 or not permission_bits or file_type not in (stat.S_IFREG, stat.S_IFDIR):
                fail(errors, entry.filename, permission_bits, 'ZIP entry lacks usable Unix file type/mode metadata')
                continue
            if file_type == stat.S_IFLNK:
                fail(errors, entry.filename, permission_bits, 'archive symlink is prohibited')
            if permission_bits & 0o022:
                fail(errors, entry.filename, permission_bits, 'stored source mode grants group/world write')
        for secret in policy['secret_files']:
            if secret in names:
                fail(errors, secret, None, 'secret must be excluded from release ZIP')
    return errors


def extract_and_validate(archive_path: Path, destination: Path) -> list[str]:
    errors = validate_zip(archive_path)
    if errors:
        return errors
    with zipfile.ZipFile(archive_path) as archive:
        for entry in archive.infolist():
            if not safe_member(entry.filename):
                fail(errors, entry.filename, None, 'archive path is unsafe during extraction')
                continue
            target = destination / PurePosixPath(entry.filename)
            target.parent.mkdir(parents=True, exist_ok=True)
            stored = (entry.external_attr >> 16) & 0xffff
            if entry.is_dir():
                target.mkdir(exist_ok=True)
            else:
                target.write_bytes(archive.read(entry))
            os.chmod(target, stored & 0o777)
    return errors + validate_tree(destination, require_runtime=False)


def expect_failure(label, action):
    try:
        action()
    except AssertionError:
        return
    raise AssertionError(f'{label} did not fail')


def self_test():
    policy = load_policy()
    with tempfile.TemporaryDirectory() as raw:
        root = Path(raw)
        for rel in policy['source_roots']:
            (root / rel).mkdir(parents=True, exist_ok=True)
        for rel in policy['runtime_writable_directories']:
            (root / rel).mkdir(parents=True, exist_ok=True)
            os.chmod(root / rel, 0o750)
        source = root / 'backend/nested.php'; source.write_text('<?php'); os.chmod(source, 0o644)
        secret = root / '.env'; secret.write_text('SECRET=x'); os.chmod(secret, 0o400)
        assert not validate_tree(root, policy), 'safe fixture failed'
        os.chmod(source, 0o664); assert validate_tree(root, policy); os.chmod(source, 0o644)
        nested = root / 'backend/nested'; nested.mkdir(); os.chmod(nested, 0o775); assert validate_tree(root, policy); os.chmod(nested, 0o755)
        os.chmod(secret, 0o644); assert validate_tree(root, policy); os.chmod(secret, 0o400); assert not validate_tree(root, policy)
        bad_runtime = root / 'var/unexpected'; bad_runtime.mkdir(); os.chmod(bad_runtime, 0o750); assert validate_tree(root, policy)
        os.chmod(bad_runtime, 0o755); bad_runtime.rmdir()
        archive = root / 'release.zip'; build_release(root, archive); assert not validate_zip(archive)
        with zipfile.ZipFile(root / 'bad.zip', 'w') as bad:
            entry = zipfile.ZipInfo('backend/unsafe.php'); entry.create_system = 3; entry.external_attr = (stat.S_IFREG | 0o666) << 16; bad.writestr(entry, b'x')
            directory = zipfile.ZipInfo('backend/unsafe/'); directory.create_system = 3; directory.external_attr = (stat.S_IFDIR | 0o777) << 16; bad.writestr(directory, b'')
            traversal = zipfile.ZipInfo('../escape'); traversal.create_system = 3; traversal.external_attr = (stat.S_IFREG | 0o644) << 16; bad.writestr(traversal, b'x')
        assert validate_zip(root / 'bad.zip'), 'unsafe ZIP fixture passed'
    print('OK: POSIX permission and ZIP negative fixtures passed.')


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest='command', required=True)
    for command in ('validate-tree', 'build-release', 'validate-zip', 'extract-validate'):
        item = sub.add_parser(command); item.add_argument('--root', type=Path, default=Path.cwd()); item.add_argument('--zip', type=Path); item.add_argument('--output', type=Path); item.add_argument('--destination', type=Path)
    sub.add_parser('self-test')
    args = parser.parse_args()
    if args.command == 'self-test': self_test(); return 0
    if args.command == 'validate-tree': return print_errors(validate_tree(args.root.resolve(), require_runtime=False))
    if args.command == 'build-release': build_release(args.root.resolve(), args.output or args.root / 'dist/fastasl-release.zip'); return 0
    if args.command == 'validate-zip': return print_errors(validate_zip(args.zip))
    if args.command == 'extract-validate':
        destination = args.destination or Path(tempfile.mkdtemp(prefix='fastasl-release-'))
        try: return print_errors(extract_and_validate(args.zip, destination))
        finally: shutil.rmtree(destination, ignore_errors=True)

if __name__ == '__main__':
    sys.exit(main())