/**
 * Builders for MCP tool results. Every tool returns the same shape.
 */

export function jsonResult(structuredContent: Record<string, unknown>) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(structuredContent, null, 2),
      },
    ],
    structuredContent,
  };
}

export function errorResult(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true as const,
  };
}
