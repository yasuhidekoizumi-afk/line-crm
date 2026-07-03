import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";
import { autoTrackUrls } from "./auto-track-urls.js";

export function registerBroadcast(server: McpServer): void {
  server.tool(
    "broadcast",
    "Send a broadcast message to all friends, a specific tag group, or a saved segment. Creates and immediately sends the broadcast.",
    {
      title: z
        .string()
        .describe("Internal title for this broadcast (not shown to users)"),
      messageType: z.enum(["text", "flex"]).describe("Message type"),
      messageContent: z
        .string()
        .describe(
          "Message content. For text: plain string. For flex: JSON string.",
        ),
      targetType: z
        .enum(["all", "tag", "segment"])
        .default("all")
        .describe(
          "Target audience: 'all' for everyone, 'tag' for a tag group, or 'segment' for a saved segment",
        ),
      targetTagId: z
        .string()
        .optional()
        .describe("Tag ID when targetType is 'tag'"),
      targetSegmentId: z
        .string()
        .optional()
        .describe("Saved segment ID when targetType is 'segment'"),
      scheduledAt: z
        .string()
        .optional()
        .describe("ISO 8601 datetime to schedule. Omit to send immediately."),
      altText: z
        .string()
        .optional()
        .describe(
          "Custom notification preview text for Flex Messages (shown on lock screen). If omitted, auto-extracted from Flex content.",
        ),
      accountId: z
        .string()
        .optional()
        .describe("LINE account ID (uses default if omitted)"),
    },
    async ({
      title,
      messageType,
      messageContent,
      targetType,
      targetTagId,
      targetSegmentId,
      scheduledAt,
      altText,
      accountId,
    }) => {
      try {
        const client = getClient();

        if (targetType === "segment" && !targetSegmentId) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    success: false,
                    error: "targetSegmentId is required when targetType is 'segment'",
                  },
                  null,
                  2,
                ),
              },
            ],
            isError: true,
          };
        }

        // Auto-track URLs in flex messages
        const { content: trackedContent, trackedUrls } = await autoTrackUrls(
          client,
          messageContent,
          messageType,
          title,
        );

        const broadcast = await client.broadcasts.create({
          title,
          messageType,
          messageContent: trackedContent,
          targetType,
          targetTagId,
          targetSegmentId,
          scheduledAt,
          lineAccountId: accountId,
          altText,
        });

        const result = scheduledAt
          ? broadcast
          : await client.broadcasts.send(broadcast.id);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { success: true, broadcast: result },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { success: false, error: String(error) },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
