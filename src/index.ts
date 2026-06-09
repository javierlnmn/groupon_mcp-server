import { createServer } from "@/config/server";

const COLOR = process.stdout.isTTY ?? false;
const paint = (code: number) => (s: string) =>
  COLOR ? `\x1b[${code}m${s}\x1b[0m` : s;

const bold = paint(1);
const dim = paint(2);
const green = paint(32);
const cyan = paint(36);
const yellow = paint(33);
const magenta = paint(35);

function link(url: string, color: (s: string) => string = cyan): string {
  if (!COLOR) return url;
  return `\x1b]8;;${url}\x1b\\${color(url)}\x1b]8;;\x1b\\`;
}

const PORT = 3000;
const app = createServer();
const baseUrl = `http://localhost:${PORT}`;

app.listen(PORT, () => {
  if (process.env.NODE_ENV === "production") {
    console.log(`Server listening on port ${PORT}`);
    return;
  }

  const health = `${baseUrl}/health`;
  const deals = `${baseUrl}/deals`;

  console.log(
    [
      "",
      `${bold(cyan("Groupon"))} ${dim("MCP server · dev")}`,
      "",
      `  ${yellow(">")} ${dim("API base")}\t${link(baseUrl, cyan)}`,
      `  ${yellow(">")} ${dim("Health")}\t${link(health, green)}`,
      `  ${yellow(">")} ${dim("Deals")}\t${link(deals, magenta)}`,
      "",
    ].join("\n"),
  );
});
