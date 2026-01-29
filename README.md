# Lovable MCP Server v2.0.0

MCP server for managing Lovable.dev projects via GitHub integration. Since Lovable syncs projects to GitHub, this server provides full access to your Lovable projects through the GitHub API.

## Features

- **50 comprehensive tools** for complete Lovable project management
- Auto-detects Lovable projects by signature files
- Full read/write access to project files
- Version control, PRs, issues, releases
- Lovable-specific tools for components, pages, hooks
- Generate Build-with-URL links

## All 50 Tools

### Project Discovery (5 tools)
| Tool | Description |
|------|-------------|
| `list_projects` | List all Lovable projects in your account |
| `get_project` | Get detailed project info with dependencies |
| `get_project_structure` | Browse file/folder structure |
| `get_full_tree` | Get complete recursive file tree |
| `get_project_stats` | Get project statistics (size, stars, languages) |

### File Operations (7 tools)
| Tool | Description |
|------|-------------|
| `read_file` | Read file contents |
| `read_multiple_files` | Read multiple files at once |
| `update_file` | Create or update files (syncs to Lovable) |
| `delete_file` | Delete files |
| `rename_file` | Rename/move files |
| `copy_file` | Copy files |
| `get_file_history` | Get commit history for a file |

### Version Control (7 tools)
| Tool | Description |
|------|-------------|
| `get_commits` | Get recent commits |
| `get_commit_details` | Get detailed commit info with file changes |
| `get_branches` | List all branches |
| `create_branch` | Create new branch |
| `delete_branch` | Delete a branch |
| `compare` | Compare branches/commits |
| `get_diff` | Get diff between refs |

### Tags & Releases (4 tools)
| Tool | Description |
|------|-------------|
| `list_tags` | List all tags |
| `create_tag` | Create new tag |
| `list_releases` | List releases |
| `create_release` | Create new release |

### Pull Requests (4 tools)
| Tool | Description |
|------|-------------|
| `list_pull_requests` | List PRs |
| `get_pull_request` | Get PR details |
| `create_pull_request` | Create new PR |
| `merge_pull_request` | Merge a PR |

### Issues (3 tools)
| Tool | Description |
|------|-------------|
| `list_issues` | List issues |
| `create_issue` | Create new issue |
| `update_issue` | Update/close issue |

### Search (3 tools)
| Tool | Description |
|------|-------------|
| `search_code` | Search code in project |
| `search_commits` | Search commits |
| `search_issues` | Search issues and PRs |

### Lovable-Specific (16 tools)
| Tool | Description |
|------|-------------|
| `list_components` | List shadcn/ui components |
| `list_custom_components` | List custom components |
| `list_pages` | List pages |
| `list_hooks` | List custom hooks |
| `list_contexts` | List React contexts |
| `list_utils` | List utility functions |
| `list_types` | List TypeScript types |
| `list_integrations` | List Supabase/external integrations |
| `get_supabase_config` | Get Supabase configuration |
| `get_tailwind_config` | Get Tailwind config |
| `get_vite_config` | Get Vite config |
| `get_package_json` | Get package.json |
| `get_env_example` | Get .env.example |
| `analyze_dependencies` | Analyze and categorize dependencies |
| `get_routes` | Extract routes from App.tsx |
| `get_readme` | Get README content |

### Collaboration (2 tools)
| Tool | Description |
|------|-------------|
| `get_contributors` | List project contributors |
| `get_languages` | Get language breakdown |

### Build URL (1 tool)
| Tool | Description |
|------|-------------|
| `generate_build_url` | Generate Lovable Build-with-URL link |

## Deployment

### Railway (Recommended)

1. Deploy from GitHub: `hemichaeli/lovable-mcp-server`
2. Set environment variables:
   - `GITHUB_TOKEN` - GitHub personal access token with repo access
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
- **URL**: `https://lovable-mcp-server-production.up.railway.app/sse`
- **Auth**: No Auth (credentials in env vars)

## How It Works

Lovable automatically syncs projects to GitHub when you enable GitHub integration. This MCP server:

1. Detects Lovable projects by checking for `vite.config.ts`, `tailwind.config.ts`, and `components.json`
2. Provides read/write access via GitHub API
3. Changes pushed to GitHub sync back to Lovable automatically

## Example Usage

```
"List my Lovable projects"
"Show me the components in genovate-portal"
"Read the App.tsx file from genovate-portal"
"Create a new page called Dashboard.tsx"
"Create a PR to merge feature-branch into main"
"What dependencies does my project use?"
"Get the routes defined in genovate-portal"
```

## License

MIT
