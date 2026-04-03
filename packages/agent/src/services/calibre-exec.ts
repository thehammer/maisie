interface CalibreExecConfig {
  containerName: string;
  libraryPath: string;
}

export function createCalibreExec(config: CalibreExecConfig) {
  async function exec(args: string[]): Promise<string> {
    const calibreArgs = ["calibredb", ...args, "--library-path", config.libraryPath];

    const proc = Bun.spawn(
      ["docker", "exec", config.containerName, ...calibreArgs],
      { stdout: "pipe", stderr: "pipe" },
    );

    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    if (exitCode !== 0 && stderr.trim()) {
      throw new Error(`calibredb failed (exit ${exitCode}): ${stderr.trim()}`);
    }

    return stdout.trim();
  }

  return {
    async list(fields: string[] = ["title", "authors", "tags", "series", "identifiers"]): Promise<string> {
      return exec(["list", "--fields", fields.join(","), "--for-machine"]);
    },

    async setMetadata(bookId: number, fields: Record<string, string>): Promise<string> {
      const args = ["set_metadata", String(bookId)];
      for (const [key, value] of Object.entries(fields)) {
        args.push("--field", `${key}:${value}`);
      }
      return exec(args);
    },

    async test(): Promise<boolean> {
      try {
        const result = await exec(["list", "--fields", "title", "--for-machine"]);
        return result.startsWith("[");
      } catch {
        return false;
      }
    },

    async addBook(localFilePath: string): Promise<{ bookId: number; output: string }> {
      const origName = localFilePath.split("/").pop()!;
      const ext = origName.includes(".") ? origName.substring(origName.lastIndexOf(".")) : ".epub";
      const safeName = `maisie-upload-${Date.now()}${ext}`;
      const containerTmp = `/tmp/${safeName}`;

      // Copy file into the Calibre container
      const cpProc = Bun.spawn(
        ["docker", "cp", localFilePath, `${config.containerName}:${containerTmp}`],
        { stdout: "pipe", stderr: "pipe" },
      );
      const cpExit = await cpProc.exited;
      if (cpExit !== 0) {
        const cpErr = await new Response(cpProc.stderr).text();
        throw new Error(`docker cp failed (exit ${cpExit}): ${cpErr.trim()}`);
      }

      // Run calibredb add
      const output = await exec(["add", containerTmp]);

      // Clean up temp file in container
      Bun.spawn(
        ["docker", "exec", config.containerName, "rm", "-f", containerTmp],
        { stdout: "pipe", stderr: "pipe" },
      );

      // Parse book ID from output like "Added book ids: 559"
      const idMatch = output.match(/Added book ids?:\s*(\d+)/);
      const bookId = idMatch ? Number(idMatch[1]) : 0;

      return { bookId, output };
    },

    exec,
  };
}

export type CalibreExec = ReturnType<typeof createCalibreExec>;

export function createCalibreExecFromEnv() {
  return createCalibreExec({
    containerName: process.env.CALIBRE_CONTAINER_NAME || "calibre",
    libraryPath: process.env.CALIBRE_LIBRARY_PATH || "/config/Calibre Library",
  });
}
