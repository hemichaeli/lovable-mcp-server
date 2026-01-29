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
    version: "2.0.0",
  });

  // ==================== PROJECT DISCOVERY ====================

  server.tool("list_projects", "List all Lovable projects in the configured GitHub account", {
    includePrivate: z.boolean().optional().describe("Include private repos (default: true)"),
  }, async ({ includePrivate = true }) => {
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

  server.tool("get_project", "Get detailed information about a Lovable project", {
    repo: z.string().describe("Repository name"),
  }, async ({ repo }) => {
    const info = await getLovableProjectInfo(GITHUB_OWNER, repo);
    return { content: [{ type: "text", text: JSON.stringify(info, null, 2) }] };
  });

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

  server.tool("get_full_tree", "Get the complete recursive file tree of a project", {
    repo: z.string().describe("Repository name"),
    branch: z.string().optional().describe("Branch name (default: main)"),
  }, async ({ repo, branch }) => {
    const tree = await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/git/trees/${branch || "main"}?recursive=1`);
    
    const files = tree.tree.map((item: any) => ({
      path: item.path,
      type: item.type,
      size: item.size,
    }));
    
    return { content: [{ type: "text", text: JSON.stringify(files, null, 2) }] };
  });

  server.tool("get_project_stats", "Get statistics about a Lovable project", {
    repo: z.string().describe("Repository name"),
  }, async ({ repo }) => {
    const [repoData, languages, contributors, commits] = await Promise.all([
      githubRequest(`/repos/${GITHUB_OWNER}/${repo}`),
      githubRequest(`/repos/${GITHUB_OWNER}/${repo}/languages`),
      githubRequest(`/repos/${GITHUB_OWNER}/${repo}/contributors`).catch(() => []),
      githubRequest(`/repos/${GITHUB_OWNER}/${repo}/commits?per_page=1`),
    ]);
    
    return { content: [{ type: "text", text: JSON.stringify({
      size: repoData.size,
      stars: repoData.stargazers_count,
      forks: repoData.forks_count,
      openIssues: repoData.open_issues_count,
      languages,
      contributorsCount: contributors.length,
      defaultBranch: repoData.default_branch,
      createdAt: repoData.created_at,
      lastPush: repoData.pushed_at,
    }, null, 2) }] };
  });

  // ==================== FILE OPERATIONS ====================

  server.tool("read_file", "Read the contents of a file in a Lovable project", {
    repo: z.string().describe("Repository name"),
    path: z.string().describe("File path"),
    branch: z.string().optional().describe("Branch name (default: main)"),
  }, async ({ repo, path, branch }) => {
    const ref = branch ? `?ref=${branch}` : "";
    const file = await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/contents/${path}${ref}`);
    const content = Buffer.from(file.content, "base64").toString();
    
    return { content: [{ type: "text", text: content }] };
  });

  server.tool("read_multiple_files", "Read multiple files at once", {
    repo: z.string().describe("Repository name"),
    paths: z.array(z.string()).describe("Array of file paths"),
  }, async ({ repo, paths }) => {
    const results: Record<string, string> = {};
    
    for (const path of paths) {
      try {
        const file = await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/contents/${path}`);
        results[path] = Buffer.from(file.content, "base64").toString();
      } catch (e: any) {
        results[path] = `Error: ${e.message}`;
      }
    }
    
    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
  });

  server.tool("update_file", "Create or update a file in a Lovable project (syncs to Lovable)", {
    repo: z.string().describe("Repository name"),
    path: z.string().describe("File path"),
    content: z.string().describe("File content"),
    message: z.string().describe("Commit message"),
    branch: z.string().optional().describe("Branch name (default: main)"),
  }, async ({ repo, path, content, message, branch }) => {
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

  server.tool("delete_file", "Delete a file from a Lovable project", {
    repo: z.string().describe("Repository name"),
    path: z.string().describe("File path"),
    message: z.string().describe("Commit message"),
    branch: z.string().optional().describe("Branch name (default: main)"),
  }, async ({ repo, path, message, branch }) => {
    const existing = await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/contents/${path}`);
    
    await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/contents/${path}`, {
      method: "DELETE",
      body: JSON.stringify({
        message,
        sha: existing.sha,
        branch: branch || "main",
      }),
    });
    
    return { content: [{ type: "text", text: JSON.stringify({ success: true, deleted: path }, null, 2) }] };
  });

  server.tool("rename_file", "Rename/move a file in a Lovable project", {
    repo: z.string().describe("Repository name"),
    oldPath: z.string().describe("Current file path"),
    newPath: z.string().describe("New file path"),
    message: z.string().describe("Commit message"),
  }, async ({ repo, oldPath, newPath, message }) => {
    // Read old file
    const file = await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/contents/${oldPath}`);
    const content = Buffer.from(file.content, "base64").toString();
    
    // Create new file
    await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/contents/${newPath}`, {
      method: "PUT",
      body: JSON.stringify({
        message: `${message} (create)`,
        content: Buffer.from(content).toString("base64"),
      }),
    });
    
    // Delete old file
    await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/contents/${oldPath}`, {
      method: "DELETE",
      body: JSON.stringify({
        message: `${message} (delete old)`,
        sha: file.sha,
      }),
    });
    
    return { content: [{ type: "text", text: JSON.stringify({ success: true, from: oldPath, to: newPath }, null, 2) }] };
  });

  server.tool("copy_file", "Copy a file within a Lovable project", {
    repo: z.string().describe("Repository name"),
    sourcePath: z.string().describe("Source file path"),
    destPath: z.string().describe("Destination file path"),
    message: z.string().describe("Commit message"),
  }, async ({ repo, sourcePath, destPath, message }) => {
    const file = await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/contents/${sourcePath}`);
    const content = Buffer.from(file.content, "base64").toString();
    
    const result = await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/contents/${destPath}`, {
      method: "PUT",
      body: JSON.stringify({
        message,
        content: Buffer.from(content).toString("base64"),
      }),
    });
    
    return { content: [{ type: "text", text: JSON.stringify({ success: true, copied: destPath, commit: result.commit.sha }, null, 2) }] };
  });

  server.tool("get_file_history", "Get the commit history for a specific file", {
    repo: z.string().describe("Repository name"),
    path: z.string().describe("File path"),
    limit: z.number().optional().describe("Number of commits (default: 10)"),
  }, async ({ repo, path, limit }) => {
    const commits = await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/commits?path=${encodeURIComponent(path)}&per_page=${limit || 10}`);
    
    const formatted = commits.map((c: any) => ({
      sha: c.sha.substring(0, 7),
      message: c.commit.message,
      author: c.commit.author.name,
      date: c.commit.author.date,
    }));
    
    return { content: [{ type: "text", text: JSON.stringify(formatted, null, 2) }] };
  });

  // ==================== VERSION CONTROL ====================

  server.tool("get_commits", "Get recent commits for a Lovable project", {
    repo: z.string().describe("Repository name"),
    branch: z.string().optional().describe("Branch name"),
    limit: z.number().optional().describe("Number of commits (default: 10)"),
  }, async ({ repo, branch, limit }) => {
    const branchParam = branch ? `&sha=${branch}` : "";
    const commits = await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/commits?per_page=${limit || 10}${branchParam}`);
    
    const formatted = commits.map((c: any) => ({
      sha: c.sha.substring(0, 7),
      fullSha: c.sha,
      message: c.commit.message,
      author: c.commit.author.name,
      date: c.commit.author.date,
      url: c.html_url,
    }));
    
    return { content: [{ type: "text", text: JSON.stringify(formatted, null, 2) }] };
  });

  server.tool("get_commit_details", "Get detailed information about a specific commit", {
    repo: z.string().describe("Repository name"),
    sha: z.string().describe("Commit SHA"),
  }, async ({ repo, sha }) => {
    const commit = await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/commits/${sha}`);
    
    return { content: [{ type: "text", text: JSON.stringify({
      sha: commit.sha,
      message: commit.commit.message,
      author: commit.commit.author,
      committer: commit.commit.committer,
      stats: commit.stats,
      files: commit.files.map((f: any) => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        changes: f.changes,
      })),
    }, null, 2) }] };
  });

  server.tool("get_branches", "List branches in a Lovable project", {
    repo: z.string().describe("Repository name"),
  }, async ({ repo }) => {
    const branches = await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/branches`);
    
    const formatted = branches.map((b: any) => ({
      name: b.name,
      protected: b.protected,
      sha: b.commit.sha.substring(0, 7),
    }));
    
    return { content: [{ type: "text", text: JSON.stringify(formatted, null, 2) }] };
  });

  server.tool("create_branch", "Create a new branch in a Lovable project", {
    repo: z.string().describe("Repository name"),
    branch: z.string().describe("New branch name"),
    fromBranch: z.string().optional().describe("Source branch (default: main)"),
  }, async ({ repo, branch, fromBranch }) => {
    const sourceRef = await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/git/ref/heads/${fromBranch || "main"}`);
    
    const result = await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/git/refs`, {
      method: "POST",
      body: JSON.stringify({
        ref: `refs/heads/${branch}`,
        sha: sourceRef.object.sha,
      }),
    });
    
    return { content: [{ type: "text", text: JSON.stringify({ success: true, branch, sha: result.object.sha }, null, 2) }] };
  });

  server.tool("delete_branch", "Delete a branch from a Lovable project", {
    repo: z.string().describe("Repository name"),
    branch: z.string().describe("Branch name to delete"),
  }, async ({ repo, branch }) => {
    await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/git/refs/heads/${branch}`, {
      method: "DELETE",
    });
    
    return { content: [{ type: "text", text: JSON.stringify({ success: true, deleted: branch }, null, 2) }] };
  });

  server.tool("compare", "Compare two branches or commits", {
    repo: z.string().describe("Repository name"),
    base: z.string().describe("Base branch/commit"),
    head: z.string().describe("Head branch/commit"),
  }, async ({ repo, base, head }) => {
    const comparison = await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/compare/${base}...${head}`);
    
    return { content: [{ type: "text", text: JSON.stringify({
      status: comparison.status,
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

  server.tool("get_diff", "Get the diff for a commit or between refs", {
    repo: z.string().describe("Repository name"),
    base: z.string().describe("Base ref (branch/commit)"),
    head: z.string().describe("Head ref (branch/commit)"),
  }, async ({ repo, base, head }) => {
    const response = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${repo}/compare/${base}...${head}`, {
      headers: {
        "Authorization": `Bearer ${GITHUB_TOKEN}`,
        "Accept": "application/vnd.github.v3.diff",
      },
    });
    
    const diff = await response.text();
    return { content: [{ type: "text", text: diff }] };
  });

  // ==================== TAGS & RELEASES ====================

  server.tool("list_tags", "List tags in a Lovable project", {
    repo: z.string().describe("Repository name"),
  }, async ({ repo }) => {
    const tags = await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/tags`);
    
    const formatted = tags.map((t: any) => ({
      name: t.name,
      sha: t.commit.sha.substring(0, 7),
    }));
    
    return { content: [{ type: "text", text: JSON.stringify(formatted, null, 2) }] };
  });

  server.tool("create_tag", "Create a new tag", {
    repo: z.string().describe("Repository name"),
    tag: z.string().describe("Tag name"),
    sha: z.string().describe("Commit SHA to tag"),
    message: z.string().optional().describe("Tag message"),
  }, async ({ repo, tag, sha, message }) => {
    // Create annotated tag object
    const tagObject = await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/git/tags`, {
      method: "POST",
      body: JSON.stringify({
        tag,
        message: message || tag,
        object: sha,
        type: "commit",
      }),
    });
    
    // Create reference
    await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/git/refs`, {
      method: "POST",
      body: JSON.stringify({
        ref: `refs/tags/${tag}`,
        sha: tagObject.sha,
      }),
    });
    
    return { content: [{ type: "text", text: JSON.stringify({ success: true, tag, sha: tagObject.sha }, null, 2) }] };
  });

  server.tool("list_releases", "List releases for a Lovable project", {
    repo: z.string().describe("Repository name"),
  }, async ({ repo }) => {
    const releases = await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/releases`);
    
    const formatted = releases.map((r: any) => ({
      id: r.id,
      name: r.name,
      tagName: r.tag_name,
      draft: r.draft,
      prerelease: r.prerelease,
      createdAt: r.created_at,
      publishedAt: r.published_at,
      url: r.html_url,
    }));
    
    return { content: [{ type: "text", text: JSON.stringify(formatted, null, 2) }] };
  });

  server.tool("create_release", "Create a new release", {
    repo: z.string().describe("Repository name"),
    tagName: z.string().describe("Tag name for the release"),
    name: z.string().describe("Release title"),
    body: z.string().optional().describe("Release notes"),
    draft: z.boolean().optional().describe("Create as draft"),
    prerelease: z.boolean().optional().describe("Mark as prerelease"),
  }, async ({ repo, tagName, name, body, draft, prerelease }) => {
    const release = await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/releases`, {
      method: "POST",
      body: JSON.stringify({
        tag_name: tagName,
        name,
        body: body || "",
        draft: draft || false,
        prerelease: prerelease || false,
      }),
    });
    
    return { content: [{ type: "text", text: JSON.stringify({
      success: true,
      id: release.id,
      url: release.html_url,
    }, null, 2) }] };
  });

  // ==================== PULL REQUESTS ====================

  server.tool("list_pull_requests", "List pull requests for a Lovable project", {
    repo: z.string().describe("Repository name"),
    state: z.enum(["open", "closed", "all"]).optional().describe("PR state filter"),
  }, async ({ repo, state }) => {
    const prs = await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/pulls?state=${state || "open"}`);
    
    const formatted = prs.map((pr: any) => ({
      number: pr.number,
      title: pr.title,
      state: pr.state,
      author: pr.user.login,
      base: pr.base.ref,
      head: pr.head.ref,
      createdAt: pr.created_at,
      updatedAt: pr.updated_at,
      url: pr.html_url,
    }));
    
    return { content: [{ type: "text", text: JSON.stringify(formatted, null, 2) }] };
  });

  server.tool("get_pull_request", "Get details of a specific pull request", {
    repo: z.string().describe("Repository name"),
    number: z.number().describe("PR number"),
  }, async ({ repo, number }) => {
    const pr = await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/pulls/${number}`);
    
    return { content: [{ type: "text", text: JSON.stringify({
      number: pr.number,
      title: pr.title,
      body: pr.body,
      state: pr.state,
      author: pr.user.login,
      base: pr.base.ref,
      head: pr.head.ref,
      mergeable: pr.mergeable,
      merged: pr.merged,
      additions: pr.additions,
      deletions: pr.deletions,
      changedFiles: pr.changed_files,
      createdAt: pr.created_at,
      url: pr.html_url,
    }, null, 2) }] };
  });

  server.tool("create_pull_request", "Create a new pull request", {
    repo: z.string().describe("Repository name"),
    title: z.string().describe("PR title"),
    head: z.string().describe("Head branch (source)"),
    base: z.string().describe("Base branch (target)"),
    body: z.string().optional().describe("PR description"),
  }, async ({ repo, title, head, base, body }) => {
    const pr = await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/pulls`, {
      method: "POST",
      body: JSON.stringify({
        title,
        head,
        base,
        body: body || "",
      }),
    });
    
    return { content: [{ type: "text", text: JSON.stringify({
      success: true,
      number: pr.number,
      url: pr.html_url,
    }, null, 2) }] };
  });

  server.tool("merge_pull_request", "Merge a pull request", {
    repo: z.string().describe("Repository name"),
    number: z.number().describe("PR number"),
    mergeMethod: z.enum(["merge", "squash", "rebase"]).optional().describe("Merge method"),
    commitMessage: z.string().optional().describe("Custom commit message"),
  }, async ({ repo, number, mergeMethod, commitMessage }) => {
    const result = await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/pulls/${number}/merge`, {
      method: "PUT",
      body: JSON.stringify({
        merge_method: mergeMethod || "merge",
        commit_message: commitMessage,
      }),
    });
    
    return { content: [{ type: "text", text: JSON.stringify({
      success: result.merged,
      sha: result.sha,
      message: result.message,
    }, null, 2) }] };
  });

  // ==================== ISSUES ====================

  server.tool("list_issues", "List issues for a Lovable project", {
    repo: z.string().describe("Repository name"),
    state: z.enum(["open", "closed", "all"]).optional().describe("Issue state filter"),
    labels: z.string().optional().describe("Comma-separated label names"),
  }, async ({ repo, state, labels }) => {
    let url = `/repos/${GITHUB_OWNER}/${repo}/issues?state=${state || "open"}`;
    if (labels) url += `&labels=${encodeURIComponent(labels)}`;
    
    const issues = await githubRequest(url);
    
    const formatted = issues
      .filter((i: any) => !i.pull_request) // Exclude PRs
      .map((i: any) => ({
        number: i.number,
        title: i.title,
        state: i.state,
        author: i.user.login,
        labels: i.labels.map((l: any) => l.name),
        createdAt: i.created_at,
        url: i.html_url,
      }));
    
    return { content: [{ type: "text", text: JSON.stringify(formatted, null, 2) }] };
  });

  server.tool("create_issue", "Create a new issue", {
    repo: z.string().describe("Repository name"),
    title: z.string().describe("Issue title"),
    body: z.string().optional().describe("Issue body"),
    labels: z.array(z.string()).optional().describe("Labels to add"),
  }, async ({ repo, title, body, labels }) => {
    const issue = await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/issues`, {
      method: "POST",
      body: JSON.stringify({
        title,
        body: body || "",
        labels: labels || [],
      }),
    });
    
    return { content: [{ type: "text", text: JSON.stringify({
      success: true,
      number: issue.number,
      url: issue.html_url,
    }, null, 2) }] };
  });

  server.tool("update_issue", "Update an existing issue", {
    repo: z.string().describe("Repository name"),
    number: z.number().describe("Issue number"),
    title: z.string().optional().describe("New title"),
    body: z.string().optional().describe("New body"),
    state: z.enum(["open", "closed"]).optional().describe("New state"),
    labels: z.array(z.string()).optional().describe("New labels"),
  }, async ({ repo, number, title, body, state, labels }) => {
    const updateData: any = {};
    if (title) updateData.title = title;
    if (body) updateData.body = body;
    if (state) updateData.state = state;
    if (labels) updateData.labels = labels;
    
    const issue = await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/issues/${number}`, {
      method: "PATCH",
      body: JSON.stringify(updateData),
    });
    
    return { content: [{ type: "text", text: JSON.stringify({
      success: true,
      number: issue.number,
      state: issue.state,
    }, null, 2) }] };
  });

  // ==================== SEARCH ====================

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

  server.tool("search_commits", "Search commits in a Lovable project", {
    repo: z.string().describe("Repository name"),
    query: z.string().describe("Search query"),
  }, async ({ repo, query }) => {
    const results = await githubRequest(`/search/commits?q=${encodeURIComponent(query)}+repo:${GITHUB_OWNER}/${repo}`, {
      headers: { "Accept": "application/vnd.github.cloak-preview+json" },
    });
    
    const formatted = results.items.map((item: any) => ({
      sha: item.sha.substring(0, 7),
      message: item.commit.message,
      author: item.commit.author.name,
      date: item.commit.author.date,
    }));
    
    return { content: [{ type: "text", text: JSON.stringify(formatted, null, 2) }] };
  });

  server.tool("search_issues", "Search issues and PRs in a Lovable project", {
    repo: z.string().describe("Repository name"),
    query: z.string().describe("Search query"),
    type: z.enum(["issue", "pr"]).optional().describe("Filter by type"),
  }, async ({ repo, query, type }) => {
    let q = `${query}+repo:${GITHUB_OWNER}/${repo}`;
    if (type === "issue") q += "+is:issue";
    if (type === "pr") q += "+is:pr";
    
    const results = await githubRequest(`/search/issues?q=${encodeURIComponent(q)}`);
    
    const formatted = results.items.map((item: any) => ({
      number: item.number,
      title: item.title,
      state: item.state,
      type: item.pull_request ? "pr" : "issue",
      author: item.user.login,
      createdAt: item.created_at,
      url: item.html_url,
    }));
    
    return { content: [{ type: "text", text: JSON.stringify(formatted, null, 2) }] };
  });

  // ==================== LOVABLE-SPECIFIC ====================

  server.tool("list_components", "List UI components (shadcn/ui) in a Lovable project", {
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

  server.tool("list_custom_components", "List custom components (non-UI) in a Lovable project", {
    repo: z.string().describe("Repository name"),
  }, async ({ repo }) => {
    try {
      const contents = await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/contents/src/components`);
      
      const components = contents
        .filter((item: any) => item.type === "file" && item.name.endsWith(".tsx"))
        .map((item: any) => ({
          name: item.name.replace(".tsx", ""),
          path: item.path,
        }));
      
      return { content: [{ type: "text", text: JSON.stringify(components, null, 2) }] };
    } catch {
      return { content: [{ type: "text", text: JSON.stringify({ error: "No custom components found" }, null, 2) }] };
    }
  });

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

  server.tool("list_contexts", "List React contexts in a Lovable project", {
    repo: z.string().describe("Repository name"),
  }, async ({ repo }) => {
    try {
      const contents = await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/contents/src/contexts`);
      
      const contexts = contents.map((item: any) => ({
        name: item.name.replace(".tsx", "").replace(".ts", ""),
        path: item.path,
      }));
      
      return { content: [{ type: "text", text: JSON.stringify(contexts, null, 2) }] };
    } catch {
      return { content: [{ type: "text", text: JSON.stringify({ error: "No contexts found" }, null, 2) }] };
    }
  });

  server.tool("list_utils", "List utility functions in a Lovable project", {
    repo: z.string().describe("Repository name"),
  }, async ({ repo }) => {
    try {
      const contents = await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/contents/src/utils`);
      
      const utils = contents.map((item: any) => ({
        name: item.name.replace(".ts", "").replace(".tsx", ""),
        path: item.path,
      }));
      
      return { content: [{ type: "text", text: JSON.stringify(utils, null, 2) }] };
    } catch {
      // Try lib folder as alternative
      try {
        const libContents = await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/contents/src/lib`);
        
        const lib = libContents.map((item: any) => ({
          name: item.name.replace(".ts", "").replace(".tsx", ""),
          path: item.path,
        }));
        
        return { content: [{ type: "text", text: JSON.stringify(lib, null, 2) }] };
      } catch {
        return { content: [{ type: "text", text: JSON.stringify({ error: "No utils/lib found" }, null, 2) }] };
      }
    }
  });

  server.tool("list_types", "List TypeScript type definitions in a Lovable project", {
    repo: z.string().describe("Repository name"),
  }, async ({ repo }) => {
    try {
      const contents = await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/contents/src/types`);
      
      const types = contents.map((item: any) => ({
        name: item.name.replace(".ts", "").replace(".d.ts", ""),
        path: item.path,
      }));
      
      return { content: [{ type: "text", text: JSON.stringify(types, null, 2) }] };
    } catch {
      return { content: [{ type: "text", text: JSON.stringify({ error: "No types folder found" }, null, 2) }] };
    }
  });

  server.tool("list_integrations", "List Supabase/external integrations in a Lovable project", {
    repo: z.string().describe("Repository name"),
  }, async ({ repo }) => {
    try {
      const contents = await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/contents/src/integrations`);
      
      const integrations = contents.map((item: any) => ({
        name: item.name,
        type: item.type,
        path: item.path,
      }));
      
      return { content: [{ type: "text", text: JSON.stringify(integrations, null, 2) }] };
    } catch {
      return { content: [{ type: "text", text: JSON.stringify({ error: "No integrations found" }, null, 2) }] };
    }
  });

  server.tool("get_supabase_config", "Get Supabase configuration if present", {
    repo: z.string().describe("Repository name"),
  }, async ({ repo }) => {
    try {
      const client = await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/contents/src/integrations/supabase/client.ts`);
      const clientContent = Buffer.from(client.content, "base64").toString();
      
      let types = null;
      try {
        const typesFile = await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/contents/src/integrations/supabase/types.ts`);
        types = Buffer.from(typesFile.content, "base64").toString();
      } catch {}
      
      return { content: [{ type: "text", text: JSON.stringify({
        hasSupabase: true,
        client: clientContent,
        types: types ? "Found (use read_file to view)" : "Not found",
      }, null, 2) }] };
    } catch {
      return { content: [{ type: "text", text: JSON.stringify({ hasSupabase: false }, null, 2) }] };
    }
  });

  server.tool("get_tailwind_config", "Get Tailwind CSS configuration", {
    repo: z.string().describe("Repository name"),
  }, async ({ repo }) => {
    try {
      const config = await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/contents/tailwind.config.ts`);
      const content = Buffer.from(config.content, "base64").toString();
      return { content: [{ type: "text", text: content }] };
    } catch {
      return { content: [{ type: "text", text: "No tailwind.config.ts found" }] };
    }
  });

  server.tool("get_vite_config", "Get Vite configuration", {
    repo: z.string().describe("Repository name"),
  }, async ({ repo }) => {
    try {
      const config = await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/contents/vite.config.ts`);
      const content = Buffer.from(config.content, "base64").toString();
      return { content: [{ type: "text", text: content }] };
    } catch {
      return { content: [{ type: "text", text: "No vite.config.ts found" }] };
    }
  });

  server.tool("get_package_json", "Get package.json with dependencies", {
    repo: z.string().describe("Repository name"),
  }, async ({ repo }) => {
    const pkg = await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/contents/package.json`);
    const content = Buffer.from(pkg.content, "base64").toString();
    return { content: [{ type: "text", text: content }] };
  });

  server.tool("get_env_example", "Get .env.example file showing required environment variables", {
    repo: z.string().describe("Repository name"),
  }, async ({ repo }) => {
    try {
      const env = await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/contents/.env.example`);
      const content = Buffer.from(env.content, "base64").toString();
      return { content: [{ type: "text", text: content }] };
    } catch {
      return { content: [{ type: "text", text: "No .env.example found" }] };
    }
  });

  server.tool("analyze_dependencies", "Analyze project dependencies and their purposes", {
    repo: z.string().describe("Repository name"),
  }, async ({ repo }) => {
    const pkg = await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/contents/package.json`);
    const packageJson = JSON.parse(Buffer.from(pkg.content, "base64").toString());
    
    const deps = packageJson.dependencies || {};
    const devDeps = packageJson.devDependencies || {};
    
    // Categorize common Lovable dependencies
    const categories: Record<string, string[]> = {
      "UI Framework": [],
      "Styling": [],
      "State Management": [],
      "Data Fetching": [],
      "Backend/Database": [],
      "Forms": [],
      "Routing": [],
      "Build Tools": [],
      "Other": [],
    };
    
    const categoryMap: Record<string, string> = {
      "react": "UI Framework",
      "react-dom": "UI Framework",
      "@radix-ui": "UI Framework",
      "lucide-react": "UI Framework",
      "tailwindcss": "Styling",
      "tailwind": "Styling",
      "class-variance-authority": "Styling",
      "clsx": "Styling",
      "@tanstack/react-query": "Data Fetching",
      "axios": "Data Fetching",
      "@supabase": "Backend/Database",
      "supabase": "Backend/Database",
      "react-hook-form": "Forms",
      "zod": "Forms",
      "react-router": "Routing",
      "vite": "Build Tools",
      "typescript": "Build Tools",
    };
    
    for (const [dep] of Object.entries({ ...deps, ...devDeps })) {
      let found = false;
      for (const [pattern, category] of Object.entries(categoryMap)) {
        if (dep.includes(pattern)) {
          categories[category].push(dep);
          found = true;
          break;
        }
      }
      if (!found) categories["Other"].push(dep);
    }
    
    // Remove empty categories
    for (const key of Object.keys(categories)) {
      if (categories[key].length === 0) delete categories[key];
    }
    
    return { content: [{ type: "text", text: JSON.stringify({
      total: Object.keys(deps).length + Object.keys(devDeps).length,
      production: Object.keys(deps).length,
      development: Object.keys(devDeps).length,
      categories,
    }, null, 2) }] };
  });

  server.tool("get_routes", "Extract routes from App.tsx or router configuration", {
    repo: z.string().describe("Repository name"),
  }, async ({ repo }) => {
    try {
      const app = await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/contents/src/App.tsx`);
      const content = Buffer.from(app.content, "base64").toString();
      
      // Extract Route components
      const routeRegex = /<Route[^>]*path=["']([^"']+)["'][^>]*(?:element=\{[^}]*<(\w+)[^>]*\/?\>)?/g;
      const routes: Array<{ path: string; component?: string }> = [];
      let match;
      
      while ((match = routeRegex.exec(content)) !== null) {
        routes.push({
          path: match[1],
          component: match[2],
        });
      }
      
      return { content: [{ type: "text", text: JSON.stringify(routes, null, 2) }] };
    } catch {
      return { content: [{ type: "text", text: JSON.stringify({ error: "Could not parse routes" }, null, 2) }] };
    }
  });

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

  server.tool("get_contributors", "List contributors to a Lovable project", {
    repo: z.string().describe("Repository name"),
  }, async ({ repo }) => {
    const contributors = await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/contributors`);
    
    const formatted = contributors.map((c: any) => ({
      login: c.login,
      contributions: c.contributions,
      url: c.html_url,
    }));
    
    return { content: [{ type: "text", text: JSON.stringify(formatted, null, 2) }] };
  });

  server.tool("get_languages", "Get language breakdown for a project", {
    repo: z.string().describe("Repository name"),
  }, async ({ repo }) => {
    const languages = await githubRequest(`/repos/${GITHUB_OWNER}/${repo}/languages`);
    
    const total = Object.values(languages).reduce((a: number, b: any) => a + b, 0) as number;
    const percentages: Record<string, string> = {};
    
    for (const [lang, bytes] of Object.entries(languages)) {
      percentages[lang] = ((bytes as number / total) * 100).toFixed(1) + "%";
    }
    
    return { content: [{ type: "text", text: JSON.stringify(percentages, null, 2) }] };
  });

  // ==================== LOVABLE BUILD URL ====================

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
    version: "2.0.0",
    owner: GITHUB_OWNER,
    toolCount: 50,
  });
});

// Tool list
const TOOLS = [
  // Project Discovery
  "list_projects", "get_project", "get_project_structure", "get_full_tree", "get_project_stats",
  // File Operations
  "read_file", "read_multiple_files", "update_file", "delete_file", "rename_file", "copy_file", "get_file_history",
  // Version Control
  "get_commits", "get_commit_details", "get_branches", "create_branch", "delete_branch", "compare", "get_diff",
  // Tags & Releases
  "list_tags", "create_tag", "list_releases", "create_release",
  // Pull Requests
  "list_pull_requests", "get_pull_request", "create_pull_request", "merge_pull_request",
  // Issues
  "list_issues", "create_issue", "update_issue",
  // Search
  "search_code", "search_commits", "search_issues",
  // Lovable-Specific
  "list_components", "list_custom_components", "list_pages", "list_hooks", "list_contexts", "list_utils", "list_types", "list_integrations",
  "get_supabase_config", "get_tailwind_config", "get_vite_config", "get_package_json", "get_env_example",
  "analyze_dependencies", "get_routes", "get_readme", "get_contributors", "get_languages",
  // Build URL
  "generate_build_url",
];

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    name: "Lovable MCP Server",
    version: "2.0.0",
    description: "MCP server for Lovable.dev via GitHub integration - 50 tools",
    endpoints: {
      sse: "/sse",
      messages: "/messages",
      health: "/health",
    },
    toolCount: TOOLS.length,
    tools: TOOLS,
  });
});

app.listen(PORT, () => {
  console.log(`Lovable MCP Server v2.0.0 running on port ${PORT}`);
  console.log(`GitHub Owner: ${GITHUB_OWNER}`);
  console.log(`Tools available: ${TOOLS.length}`);
});
