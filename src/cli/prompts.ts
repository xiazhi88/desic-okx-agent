import readline from "node:readline/promises";

export async function ask(question: string, fallback?: string): Promise<string> {
  const suffix = fallback ? ` [${fallback}]` : "";
  const interface_ = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await interface_.question(`${question}${suffix}: `);
    return answer.trim() || fallback || "";
  } finally {
    interface_.close();
  }
}

export async function askSecret(question: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY || typeof process.stdin.setRawMode !== "function") {
    return ask(question);
  }
  process.stdout.write(`${question}: `);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  return new Promise<string>((resolve, reject) => {
    let value = "";
    const cleanup = (): void => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    };
    const onData = (chunk: string): void => {
      for (const character of chunk) {
        if (character === "\r" || character === "\n") {
          cleanup();
          resolve(value);
          return;
        }
        if (character === "\u0003") {
          cleanup();
          reject(new Error("Canceled"));
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
        } else if (character >= " ") {
          value += character;
        }
      }
    };
    process.stdin.on("data", onData);
  });
}
