import express, { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";

const app = express();
const PORT = process.env.PORT || 3000;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const GITHUB_OWNER = process.env.GITHUB_OWNER || "";

// GitHub API helper
async function githubRequest(endpoint: string, options: RequestInit = {}): Promise<any> {
  const response = await fetch(`https://api.github.com${endpoint}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${GITHUB_TOKEN}`,
      "Accept": "application/vnd.github.v3+json",
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`GitHub API error: ${response.status} - ${error}`);
  }
  
  return response.json();
}

// Check if a repo is a Lovable project
async function isLovableProject(owner: string, repo: string): Promise<boolean> {
  try {
    // Check for Lovable-specific files: vite.config.ts + tailwind.config.ts + src/components/ui
    const contents = await githubRequest(`/repos/${owner}/${repo}/contents`);
    const files = contents.map((f: any) => f.name);
    
    const hasVite = files.includes("vite.config.ts");
    const hasTailwind = files.includes("tailwind.config.ts");
    const hasComponentsJson = files.includes("components.json");
    
    return hasVite && hasTailwind && hasComponentsJson;
  } catch {
    return false;
  }
}

// Get Lovable project info
async function getLovableProjectInfo(owner: string, repo: string): Promise<any> {
  const repoData = await githubRequest(`/repos/${owner}/${repo}`);
  const commits = await githubRequest(`/repos/${owner}/${repo}/commits?per_page=5`);
  
  let packageJson: any = null;
  try {
    const pkgContent = await githubRequest(`/repos/${owner}/${repo}/contents/package.json`);
    packageJson = JSON.parse(Buffer.from(pkgContent.content, "base64").toString());
  } catch {}
  
  return {
    name: repo,
    fullName: repoData.full_name,
    description: repoData.description,
    private: repoData.private,
    url: repoData.html_url,
    createdAt: repoData.created_at,
    updatedAt: repoData.updated_at,
    pushedAt: repoData.pushed_at,
    defaultBranch: repoData.default_branch,
    language: repoData.language,
    size: repoData.size,
    dependencies: packageJson?.dependencies || {},
    devDependencies: packageJson?.devDependencies || {},
    recentCommits: commits.slice(0, 5).map((c: any) => ({
      sha: c.sha.substring(0, 7),
      message: c.commit.message,
      author: c.commit.author.name,
      date: c.commit.author.date,
    })),
  };
}

// Store transports by session ID
const transports: Record<string, SSEServerTransport> = {};

// Create and configure MCP server
function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "lovable-mcp-server",
    version: "1.0.0",
  });

  // List all Lovable projects
  server.tool("list_projects", "List all Lovable projects in the configured GitHub account", {
    includePrivate: z.boolean().optional().describe("Include private repos"),
  }, async ({ includePrivate }) => {
    const repos = await githubRequest(`/users/${GITHUB_OWNER}/repos?per_page=100&sort=updated`);
    
    const lovableProjects = [];
    for (const repo of repos) {
      if (!includePrivate && repo.private) continue;
      
      if (await isLovableProject(GITHUB_OWNER, repo.name)) {
        lovableProjects.push({
          name: repo.name,
          fullName: repo.full_name,
          description: repo.description,
          private: repo.private,
          url: repo.html_url,
          updatedAt: repo.updated_at,
          language: repo.language,
        });
      }
    }
    
    return { content: [{ type: "text", text: JSON.stringify(lovableProjects, null, 2) }] };
  });

  // Get project details
  server.tool("get_project", "Get detailed information about a Lovable project", {
    repo: z.string().describe("Repository name"),
  }, async ({ repo }) => {
    const info = await getLovableProjectInfo(GITHUB_OWNER, repo);
    return { content: [{ type: "text", text: JSON.stringify(info, null, 2) }] };
  });

  // Get project structure
  server.tool("get_project_structure", "Get the file/folder structure of a Lovable project", {
    repo: z.string().describe("Repository name"),
    path: z.string().optional().describe("Path within the repo (default: root)"),
  }, async ({ repo, path }) => {
    const contents = await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/contents/${path || ""}`);
    
    const structure = contents.map((item: any) => ({
      name: item.name,
      type: item.type,
      path: item.path,
      size: item.size,
    }));
    
    return { content: [{ type: "text", text: JSON.stringify(structure, null, 2) }] };
  });

  // Read file content
  server.tool("read_file", "Read the contents of a file in a Lovable project", {
    repo: z.string().describe("Repository name"),
    path: z.string().describe("File path"),
  }, async ({ repo, path }) => {
    const file = await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/contents/${path}`);
    const content = Buffer.from(file.content, "base64").toString();
    
    return { content: [{ type: "text", text: content }] };
  });

  // Get commits
  server.tool("get_commits", "Get recent commits for a Lovable project", {
    repo: z.string().describe("Repository name"),
    limit: z.number().optional().describe("Number of commits (default: 10)"),
  }, async ({ repo, limit }) => {
    const commits = await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/commits?per_page=${limit || 10}`);
    
    const formatted = commits.map((c: any) => ({
      sha: c.sha.substring(0, 7),
      message: c.commit.message,
      author: c.commit.author.name,
      date: c.commit.author.date,
      url: c.html_url,
    }));
    
    return { content: [{ type: "text", text: JSON.stringify(formatted, null, 2) }] };
  });

  // Get branches
  server.tool("get_branches", "List branches in a Lovable project", {
    repo: z.string().describe("Repository name"),
  }, async ({ repo }) => {
    const branches = await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/branches`);
    return { content: [{ type: "text", text: JSON.stringify(branches.map((b: any) => b.name), null, 2) }] };
  });

  // Create/update file
  server.tool("update_file", "Create or update a file in a Lovable project (syncs to Lovable)", {
    repo: z.string().describe("Repository name"),
    path: z.string().describe("File path"),
    content: z.string().describe("File content"),
    message: z.string().describe("Commit message"),
    branch: z.string().optional().describe("Branch name (default: main)"),
  }, async ({ repo, path, content, message, branch }) => {
    // Check if file exists to get SHA
    let sha: string | undefined;
    try {
      const existing = await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/contents/${path}`);
      sha = existing.sha;
    } catch {}
    
    const result = await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/contents/${path}`, {
      method: "PUT",
      body: JSON.stringify({
        message,
        content: Buffer.from(content).toString("base64"),
        branch: branch || "main",
        sha,
      }),
    });
    
    return { content: [{ type: "text", text: JSON.stringify({ success: true, commit: result.commit.sha }, null, 2) }] };
  });

  // Delete file
  server.tool("delete_file", "Delete a file from a Lovable project", {
    repo: z.string().describe("Repository name"),
    path: z.string().describe("File path"),
    message: z.string().describe("Commit message"),
  }, async ({ repo, path, message }) => {
    const existing = await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/contents/${path}`);
    
    await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/contents/${path}`, {
      method: "DELETE",
      body: JSON.stringify({
        message,
        sha: existing.sha,
      }),
    });
    
    return { content: [{ type: "text", text: JSON.stringify({ success: true, deleted: path }, null, 2) }] };
  });

  // Generate Build-with-URL link
  server.tool("generate_build_url", "Generate a Lovable Build-with-URL link to create a new app", {
    prompt: z.string().describe("The prompt describing the app to build (max 50,000 chars)"),
    images: z.array(z.string()).optional().describe("Array of image URLs (max 10)"),
  }, async ({ prompt, images }) => {
    const encodedPrompt = encodeURIComponent(prompt);
    let url = `https://lovable.dev/?autosubmit=true#prompt=${encodedPrompt}`;
    
    if (images && images.length > 0) {
      const imageParams = images.slice(0, 10).map(img => `images=${encodeURIComponent(img)}`).join("&");
      url += `&${imageParams}`;
    }
    
    return { content: [{ type: "text", text: JSON.stringify({ url, promptLength: prompt.length }, null, 2) }] };
  });

  // Search in project
  server.tool("search_code", "Search for code in a Lovable project", {
    repo: z.string().describe("Repository name"),
    query: z.string().describe("Search query"),
  }, async ({ repo, query }) => {
    const results = await githubRequest(`/search/code?q=${encodeURIComponent(query)}+repo:${GITHUB_OWNER}/${repo}`);
    
    const formatted = results.items.map((item: any) => ({
      path: item.path,
      name: item.name,
      url: item.html_url,
    }));
    
    return { content: [{ type: "text", text: JSON.stringify(formatted, null, 2) }] };
  });

  // Get components (Lovable uses shadcn/ui)
  server.tool("list_components", "List UI components in a Lovable project", {
    repo: z.string().describe("Repository name"),
  }, async ({ repo }) => {
    try {
      const contents = await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/contents/src/components/ui`);
      
      const components = contents.map((item: any) => ({
        name: item.name.replace(".tsx", ""),
        path: item.path,
      }));
      
      return { content: [{ type: "text", text: JSON.stringify(components, null, 2) }] };
    } catch {
      return { content: [{ type: "text", text: JSON.stringify({ error: "No UI components found" }, null, 2) }] };
    }
  });

  // Get pages
  server.tool("list_pages", "List pages in a Lovable project", {
    repo: z.string().describe("Repository name"),
  }, async ({ repo }) => {
    try {
      const contents = await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/contents/src/pages`);
      
      const pages = contents.map((item: any) => ({
        name: item.name.replace(".tsx", ""),
        path: item.path,
      }));
      
      return { content: [{ type: "text", text: JSON.stringify(pages, null, 2) }] };
    } catch {
      return { content: [{ type: "text", text: JSON.stringify({ error: "No pages found" }, null, 2) }] };
    }
  });

  // Get hooks
  server.tool("list_hooks", "List custom hooks in a Lovable project", {
    repo: z.string().describe("Repository name"),
  }, async ({ repo }) => {
    try {
      const contents = await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/contents/src/hooks`);
      
      const hooks = contents.map((item: any) => ({
        name: item.name.replace(".ts", "").replace(".tsx", ""),
        path: item.path,
      }));
      
      return { content: [{ type: "text", text: JSON.stringify(hooks, null, 2) }] };
    } catch {
      return { content: [{ type: "text", text: JSON.stringify({ error: "No hooks found" }, null, 2) }] };
    }
  });

  // Compare branches/commits
  server.tool("compare", "Compare two branches or commits", {
    repo: z.string().describe("Repository name"),
    base: z.string().describe("Base branch/commit"),
    head: z.string().describe("Head branch/commit"),
  }, async ({ repo, base, head }) => {
    const comparison = await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/compare/${base}...${head}`);
    
    return { content: [{ type: "text", text: JSON.stringify({
      ahead: comparison.ahead_by,
      behind: comparison.behind_by,
      totalCommits: comparison.total_commits,
      files: comparison.files.map((f: any) => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
      })),
    }, null, 2) }] };
  });

  // Create branch
  server.tool("create_branch", "Create a new branch in a Lovable project", {
    repo: z.string().describe("Repository name"),
    branch: z.string().describe("New branch name"),
    fromBranch: z.string().optional().describe("Source branch (default: main)"),
  }, async ({ repo, branch, fromBranch }) => {
    // Get the SHA of the source branch
    const sourceRef = await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/git/ref/heads/${fromBranch || "main"}`);
    
    // Create new branch
    const result = await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/git/refs`, {
      method: "POST",
      body: JSON.stringify({
        ref: `refs/heads/${branch}`,
        sha: sourceRef.object.sha,
      }),
    });
    
    return { content: [{ type: "text", text: JSON.stringify({ success: true, branch, sha: result.object.sha }, null, 2) }] };
  });

  // Get README
  server.tool("get_readme", "Get the README content of a Lovable project", {
    repo: z.string().describe("Repository name"),
  }, async ({ repo }) => {
    try {
      const readme = await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/readme`);
      const content = Buffer.from(readme.content, "base64").toString();
      return { content: [{ type: "text", text: content }] };
    } catch {
      return { content: [{ type: "text", text: "No README found" }] };
    }
  });

  return server;
}

// CORS middleware
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id, Accept");
  res.header("Access-Control-Expose-Headers", "Mcp-Session-Id");
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  next();
});

// Skip JSON parsing for /messages
app.use((req, res, next) => {
  if (req.path === "/messages") {
    return next();
  }
  express.json()(req, res, next);
});

// SSE endpoint
app.get("/sse", async (req: Request, res: Response) => {
  console.log("SSE connection request received");
  
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  const transport = new SSEServerTransport("/messages", res);
  const sessionId = transport.sessionId;
  transports[sessionId] = transport;
  
  console.log(`SSE session created: ${sessionId}`);

  const mcpServer = createMcpServer();
  
  transport.onclose = () => {
    console.log(`SSE session closed: ${sessionId}`);
    delete transports[sessionId];
  };

  try {
    await mcpServer.connect(transport);
    console.log(`MCP server connected to SSE session: ${sessionId}`);
  } catch (error) {
    console.error("SSE connection error:", error);
    delete transports[sessionId];
    if (!res.headersSent) {
      res.status(500).end();
    }
  }
});

// Messages endpoint
app.post("/messages", async (req: Request, res: Response) => {
  const sessionId = req.query.sessionId as string;
  console.log(`Message received for session: ${sessionId}`);
  
  if (!sessionId) {
    return res.status(400).json({ error: "Missing sessionId" });
  }

  const transport = transports[sessionId];
  if (!transport) {
    return res.status(404).json({ error: "Session not found" });
  }

  try {
    await transport.handlePostMessage(req, res);
  } catch (error) {
    console.error("Message handling error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    sessions: Object.keys(transports).length,
    version: "1.0.0",
    owner: GITHUB_OWNER,
  });
});

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    name: "Lovable MCP Server",
    version: "1.0.0",
    description: "MCP server for Lovable.dev via GitHub integration",
    endpoints: {
      sse: "/sse",
      messages: "/messages",
      health: "/health",
    },
    tools: [
      "list_projects",
      "get_project",
      "get_project_structure",
      "read_file",
      "get_commits",
      "get_branches",
      "update_file",
      "delete_file",
      "generate_build_url",
      "search_code",
      "list_components",
      "list_pages",
      "list_hooks",
      "compare",
      "create_branch",
      "get_readme",
    ],
  });
});

app.listen(PORT, () => {
  console.log(`Lovable MCP Server running on port ${PORT}`);
  console.log(`GitHub Owner: ${GITHUB_OWNER}`);
});
