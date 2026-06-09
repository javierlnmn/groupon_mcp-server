import { createServer } from "@/config/server";
import { bold, dim, green, cyan, yellow, link } from "@/config/console";

const PORT = 3000;
const baseUrl = `http://localhost:${PORT}`;
const app = createServer(baseUrl);

app.listen(PORT, () => {
  console.log(
    [
      "",
      `${bold(cyan("Groupon"))} ${dim("MCP server")}`,
      "",
      `  ${yellow(">")} ${dim("MCP server")}\t${link(`${baseUrl}/mcp`, cyan)}`,
      `  ${yellow(">")} ${dim("Health")}\t${link(`${baseUrl}/health`, green)}`,
      "",
    ].join("\n"),
  );
});
