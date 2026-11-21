import express from "express";
import { realpathSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";

function isInsideRoot(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

function malformedPathError() {
  const error = new Error("Malformed request path");
  error.status = 400;
  return error;
}

/**
 * Serve regular files only when both their lexical and resolved paths remain
 * beneath publicRoot. Missing files and directories fall through to the safe
 * 404 middleware; unexpected filesystem failures reach the final error handler.
 */
export function createPublicStaticMiddleware(publicRoot) {
  const root = realpathSync(resolve(publicRoot));
  const serve = express.static(root, {
    dotfiles: "deny",
    fallthrough: true,
    index: false,
    redirect: false,
  });

  return async function publicStatic(req, res, next) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }

    try {
      const rawPath = req.url.split("?", 1)[0];
      const decodedPath = decodeURIComponent(rawPath);
      if (decodedPath.includes("\0")) {
        throw malformedPathError();
      }

      const lexicalCandidate = resolve(root, `.${decodedPath}`);
      if (!isInsideRoot(root, lexicalCandidate)) {
        next();
        return;
      }

      const realCandidate = await realpath(lexicalCandidate);
      if (!isInsideRoot(root, realCandidate) || !(await stat(realCandidate)).isFile()) {
        next();
        return;
      }

      serve(req, res, next);
    } catch (error) {
      if (["ENOENT", "ENOTDIR"].includes(error.code)) {
        next();
        return;
      }
      if (error instanceof URIError) {
        next(malformedPathError());
        return;
      }
      next(error);
    }
  };
}
