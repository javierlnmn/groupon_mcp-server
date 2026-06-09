import { createMcpApp } from "@/mcp/app";
import { bold, dim, green, cyan, yellow, link } from "@/utils/console";

const PORT = 3000;
const baseUrl = `http://localhost:${PORT}`;
const app = createMcpApp(baseUrl);

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
