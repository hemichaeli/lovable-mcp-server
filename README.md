# Lovable MCP Server

MCP server for managing Lovable.dev projects via GitHub integration. Since Lovable syncs projects to GitHub, this server provides full access to your Lovable projects through the GitHub API.

## Features

- **List Projects** - Find all Lovable projects in your GitHub account
- **Read/Write Files** - View and edit any file (syncs back to Lovable)
- **Project Structure** - Browse components, pages, hooks
- **Version Control** - Commits, branches, comparisons
- **Build URLs** - Generate Lovable Build-with-URL links

## Tools (16 total)

| Tool | Description |
|------|-------------|
| `list_projects` | List all Lovable projects |
| `get_project` | Get detailed project info |
| `get_project_structure` | Browse file/folder structure |
| `read_file` | Read file contents |
| `update_file` | Create or update files |
| `delete_file` | Delete files |
| `get_commits` | View recent commits |
| `get_branches` | List branches |
| `create_branch` | Create new branch |
| `compare` | Compare branches/commits |
| `search_code` | Search code in project |
| `list_components` | List UI components |
| `list_pages` | List pages |
| `list_hooks` | List custom hooks |
| `get_readme` | Get README content |
| `generate_build_url` | Generate Lovable build URL |

## Deployment

### Railway (Recommended)

1. Deploy from GitHub: `hemichaeli/lovable-mcp-server`
2. Set environment variables:
   - `GITHUB_TOKEN` - GitHub personal access token
   - `GITHUB_OWNER` - Your GitHub username
3. Add public domain

### Environment Variables

| Variable | Description |
|----------|-------------|
| `GITHUB_TOKEN` | GitHub PAT with repo access |
| `GITHUB_OWNER` | GitHub username (e.g., `hemichaeli`) |
| `PORT` | Server port (default: 3000) |

## Usage with Claude.ai

Add as MCP connector:
- **URL**: `https://your-railway-domain.up.railway.app/sse`
- **Auth**: No Auth (credentials in env vars)

## How It Works

Lovable automatically syncs projects to GitHub when you enable GitHub integration. This MCP server:

1. Detects Lovable projects by checking for `vite.config.ts`, `tailwind.config.ts`, and `components.json`
2. Provides read/write access via GitHub API
3. Changes pushed to GitHub sync back to Lovable

## Example Usage

```
"List my Lovable projects"
"Show me the components in genovate-portal"
"Read the App.tsx file from genovate-portal"
"Create a new page called Dashboard.tsx"
```

## License

MIT
