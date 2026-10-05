import { defineConfig } from "vitepress";

export default defineConfig({
  title: "MCP Server Manager",
  description:
    "The all-in-one CLI tool to manage your MCP servers across all clients",
  base: "/mcp-server-manager/",
  ignoreDeadLinks: true,

  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/logo.svg" }],
    ["meta", { name: "theme-color", content: "#6366f1" }],
  ],

  themeConfig: {
    logo: "/logo.svg",
    siteTitle: "MCP Server Manager",
    appearance: false, // Disable dark/light mode toggle

    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "CLI Reference", link: "/cli/servers" },
      { text: "TUI", link: "/tui/overview" },
      {
        text: "Links",
        items: [
          { text: "NPM", link: "https://www.npmjs.com/package/mcp-server-manager" },
        ],
      },
    ],

    sidebar: {
      "/guide/": [
        {
          text: "Getting Started",
          items: [
            { text: "Introduction", link: "/guide/getting-started" },
            { text: "Installation", link: "/guide/installation" },
            { text: "Quick Start", link: "/guide/quickstart" },
            { text: "Configuration", link: "/guide/configuration" },
          ],
        },
        {
          text: "Architecture",
          items: [
            { text: "Architecture Overview", link: "/guide/architecture" },
            { text: "Client Connections", link: "/guide/client-connections" },
          ],
        },
        {
          text: "Guides",
          items: [
            { text: "Advanced Examples", link: "/guide/advanced-examples" },
            { text: "Migration", link: "/guide/migration" },
            { text: "Troubleshooting", link: "/guide/troubleshooting" },
          ],
        },
      ],
      "/cli/": [
        {
          text: "CLI Commands",
          items: [
            { text: "Server Management", link: "/cli/servers" },
            { text: "Client Sync", link: "/cli/clients" },
            { text: "Tools", link: "/cli/tools" },
            { text: "Profiles", link: "/cli/profiles" },
            { text: "Import & Export", link: "/cli/import-export" },
            { text: "Daemon", link: "/cli/daemon" },
            { text: "Authentication", link: "/cli/auth" },
            { text: "Settings", link: "/cli/settings" },
            { text: "Utilities", link: "/cli/utilities" },
          ],
        },
      ],
      "/tui/": [
        {
          text: "Interactive TUI",
          items: [
            { text: "Overview", link: "/tui/overview" },
            { text: "Keyboard Shortcuts", link: "/tui/shortcuts" },
            { text: "Screens", link: "/tui/screens" },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: "github", link: "https://github.com/sardine-ai/mcp-server-manager" },
    ],

    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright © 2025 Sardine AI",
    },

    search: {
      provider: "local",
    },

    editLink: {
      pattern: "https://github.com/sardine-ai/mcp-server-manager/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },
  },
});
