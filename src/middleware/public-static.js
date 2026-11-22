import { constants, realpathSync } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";

function isInsideRoot(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function malformedPathError() {
  const error = new Error("Malformed request path");
  error.status = 400;
  return error;
}

function createEtag(stats) {
  return `W/"${stats.size.toString(16)}-${stats.mtimeMs.toString(16)}"`;
}

function stripWeakPrefix(value) {
  return value.startsWith("W/") ? value.slice(2) : value;
}

function isNotModified(req, etag, mtimeMs) {
  const ifNoneMatch = req.headers["if-none-match"];
  if (ifNoneMatch !== undefined) {
    return ifNoneMatch.split(",").some((candidate) => {
      const value = candidate.trim();
      return value === "*" || stripWeakPrefix(value) === stripWeakPrefix(etag);
    });
  }

  const ifModifiedSince = req.headers["if-modified-since"];
  if (ifModifiedSince === undefined) {
    return false;
  }
  const modifiedSince = Date.parse(ifModifiedSince);
  return (
    Number.isFinite(modifiedSince) &&
    Math.floor(Number(mtimeMs) / 1000) <= Math.floor(modifiedSince / 1000)
  );
}

function isRangeFresh(req, etag, mtimeMs) {
  const ifRange = req.headers["if-range"];
  if (ifRange === undefined) {
    return true;
  }
  if (ifRange.includes('"')) {
    const value = ifRange.trim();
    return !value.startsWith("W/") && value === etag;
  }

  const ifRangeDate = Date.parse(ifRange);
  return (
    Number.isFinite(ifRangeDate) &&
    Math.floor(Number(mtimeMs) / 1000) <= Math.floor(ifRangeDate / 1000)
  );
}

/** Parse exactly one byte range, rejecting malformed and unsatisfiable input. */
function parseByteRange(header, size) {
  if (header === undefined) {
    return null;
  }

  const match = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header);
  if (!match || (!match[1] && !match[2]) || size === 0) {
    return { invalid: true };
  }

  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength === 0) {
      return { invalid: true };
    }
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
      return { invalid: true };
    }
    end = Math.min(end, size - 1);
  }

  if (start >= size || start > end) {
    return { invalid: true };
  }
  return { start, end };
}

function invalidRangeError() {
  const error = new Error("Invalid byte range");
  error.status = 416;
  error.type = "range.invalid";
  return error;
}

/**
 * Open a regular file whose resolved path and identity stay inside root.
 * The returned handle, rather than a later path lookup, backs the response.
 */
async function openPublicFile(root, lexicalCandidate) {
  const realCandidate = await realpath(lexicalCandidate);
  if (!isInsideRoot(root, realCandidate)) {
    return null;
  }

  const expected = await stat(realCandidate, { bigint: true });
  if (!expected.isFile()) {
    return null;
  }

  const handle = await open(
    realCandidate,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  let keepOpen = false;
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || !sameFile(expected, opened)) {
      return null;
    }

    // Recheck resolved ancestors and path identity after opening. If a path or
    // ancestor was swapped around open(), the identities cannot all match.
    const confirmedCandidate = await realpath(realCandidate);
    if (!isInsideRoot(root, confirmedCandidate)) {
      return null;
    }
    const confirmed = await stat(confirmedCandidate, { bigint: true });
    if (!sameFile(opened, confirmed)) {
      return null;
    }

    keepOpen = true;
    return { handle, realCandidate, stats: opened };
  } finally {
    if (!keepOpen) {
      await handle.close();
    }
  }
}

/**
 * Serve GET/HEAD regular files from publicRoot without a check/use path race.
 * Missing files, directories, dotfiles, and boundary escapes fall through to
 * the safe 404 middleware; unexpected filesystem failures reach errorHandler.
 */
export function createPublicStaticMiddleware(publicRoot, options = {}) {
  const root = realpathSync(resolve(publicRoot));

  return async function publicStatic(req, res, next) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }

    let openedFile;
    try {
      const rawPath = req.url.split("?", 1)[0];
      const decodedPath = decodeURIComponent(rawPath);
      if (decodedPath.includes("\0")) {
        throw malformedPathError();
      }
      if (decodedPath.split(/[\\/]/).some((segment) => segment.startsWith("."))) {
        next();
        return;
      }

      const lexicalCandidate = resolve(root, `.${decodedPath}`);
      if (!isInsideRoot(root, lexicalCandidate)) {
        next();
        return;
      }

      openedFile = await openPublicFile(root, lexicalCandidate);
      if (!openedFile) {
        next();
        return;
      }

      // Deterministic regression seam: swap the validated path before streaming.
      // Production callers omit this hook; the response remains bound to handle.
      await options.afterFileOpen?.();

      const { handle, realCandidate, stats } = openedFile;
      const size = Number(stats.size);
      if (!Number.isSafeInteger(size)) {
        throw new Error("Static file is too large to serve safely");
      }

      const etag = createEtag(stats);
      res.set({
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=0",
        ETag: etag,
        "Last-Modified": stats.mtime.toUTCString(),
      });

      if (isNotModified(req, etag, stats.mtimeMs)) {
        res.status(304);
        res.end();
        return;
      }

      const range = isRangeFresh(req, etag, stats.mtimeMs)
        ? parseByteRange(req.headers.range, size)
        : null;
      if (range?.invalid) {
        res.set("Content-Range", `bytes */${size}`);
        throw invalidRangeError();
      }

      res.status(range ? 206 : 200);
      res.type(extname(realCandidate));
      if (range) {
        res.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
      }
      res.set("Content-Length", String(range ? range.end - range.start + 1 : size));

      if (req.method === "HEAD") {
        res.end();
        return;
      }

      try {
        const streamOptions = range
          ? { autoClose: false, start: range.start, end: range.end }
          : { autoClose: false };
        await pipeline(handle.createReadStream(streamOptions), res);
      } catch (error) {
        if (res.headersSent) {
          res.destroy(error);
          return;
        }
        throw error;
      }
    } catch (error) {
      if (["ENOENT", "ENOTDIR", "ELOOP", "EISDIR"].includes(error.code)) {
        next();
        return;
      }
      if (error instanceof URIError) {
        next(malformedPathError());
        return;
      }
      next(error);
    } finally {
      if (openedFile) {
        await openedFile.handle.close();
      }
    }
  };
}
