import { constants, realpathSync } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
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
      res.status(200);
      res.type(realCandidate);
      res.set({
        "Cache-Control": "public, max-age=0",
        "Content-Length": stats.size.toString(),
      });

      if (req.method === "HEAD") {
        res.end();
        return;
      }

      try {
        await pipeline(handle.createReadStream({ autoClose: false }), res);
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
