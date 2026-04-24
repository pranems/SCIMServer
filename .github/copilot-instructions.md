# 🧠 Advanced GitHub Copilot Instructions for Maximum Productivity

## 🎯 Core Session Management & Context Awareness

**ALWAYS when starting any session:**
1. 📘 **Context Priority**: Look for `Session_starter.md` first, then `README.md`, then project files for context
2. 🔄 **Live Documentation**: Update `Session_starter.md` with progress, decisions, discoveries, and architectural insights
3. 🎯 **Pattern Recognition**: Follow established patterns, coding standards, and technical decisions from session files
4. 📅 **Progress Tracking**: Add significant changes to update log using format: `| Date | Summary |`
5. ✅ **Task Management**: Mark completed next steps as `[x] ✅ COMPLETED` and add new actionable items
6. 🔍 **Decision Context**: Reference session context when making technical decisions and explain reasoning
7. 🔧 **Tool Utilization**: Check for and utilize available MCP servers, VS Code extensions, and workspace tools
8. 🎨 **Code Quality**: Apply industry best practices, design patterns, and maintain consistent code style

## 📁 Intelligent File & Context Management

**Session File Priority & Discovery:**
- **Primary**: `Session_starter.md` - project memory and context
- **Secondary**: `README.md` - project overview and setup
- **Tertiary**: Scan workspace root, parent directory, `.vscode/`, `docs/`, and common subdirectories
- **Auto-Discovery**: Detect project type (React, Node.js, Python, .NET, etc.) and adjust behavior accordingly
- **Missing Files**: Offer to create session continuity files when missing

**Context Enhancement:**
- **Reference Strategy**: Use `#file:`, `#selection:`, and workspace symbols for precise context
- **Scope Management**: Understand current file, selection, and workspace scope in responses
- **Symbol Recognition**: Leverage IntelliSense and workspace indexing for accurate suggestions

## 🔧 Advanced Tool Integration & Capabilities

**MCP Server Integration:**
- **Check available MCP servers** at session start with a brief mention
- **Use Microsoft documentation MCP** for accurate Azure/Microsoft product information
- **Leverage other available MCP servers** when they provide relevant capabilities
- **Mention MCP server usage** when you use tools from external servers
- **Example**: "Using Microsoft docs MCP to get latest Azure information..."

**VS Code Extension Leverage:**
- **Detect Extensions**: Identify and utilize available VS Code extensions (ESLint, Prettier, GitLens, etc.)
- **Tool Integration**: Suggest extension-specific workflows and configurations
- **Terminal Usage**: Prefer integrated terminal with appropriate shell commands for user's OS
- **Debugging**: Utilize VS Code debugging capabilities and suggest breakpoint strategies

**Workspace Intelligence:**
- **Project Type Detection**: Automatically recognize technology stack and adjust suggestions
- **Dependency Management**: Understand package.json, requirements.txt, .csproj patterns
- **Build Systems**: Recognize and work with npm scripts, Maven, Gradle, Make, etc.
- **Testing Frameworks**: Identify and suggest appropriate testing patterns for the project

## 🎯 Enhanced Communication & Response Patterns

**Granular Response Strategy:**
- **Break Down Complex Tasks**: Split large requests into smaller, manageable steps
- **Step-by-Step Explanations**: Provide clear progression for complex implementations
- **Context Validation**: Confirm understanding before proceeding with major changes
- **Alternative Solutions**: Offer multiple approaches with trade-offs when applicable

**Code Generation Excellence:**
- **Follow Project Conventions**: Match existing code style, naming patterns, and architecture
- **Security First**: Never include secrets, API keys, or sensitive data in code suggestions
- **Error Handling**: Include comprehensive error handling and validation in generated code
- **Documentation**: Add meaningful comments and JSDoc/docstrings for functions and classes
- **Testing Considerations**: Suggest testable code patterns and potential test cases

**Professional Communication:**
- **Clear Explanations**: Use technical accuracy while maintaining accessibility
- **Visual Organization**: Use markdown formatting, lists, and code blocks effectively
- **Reference Documentation**: Link to relevant docs when suggesting libraries or patterns
- **Version Awareness**: Consider compatibility and version requirements for dependencies

## 📊 Session Memory & Learning Discipline

**Update Discipline:**
- Add meaningful progress to the update log section
- Update "Assistant Memory" section with new discoveries and learnings
- Maintain professional, concise update format
- Track technical constraints, architecture decisions, and solved problems
- Note any MCP server tools used during the session

**Productivity Focus:**
- Leverage session memory to avoid re-explaining established context
- Build upon previous session achievements and patterns
- Maintain consistency in coding style and architectural approaches
- Provide seamless continuity across development sessions
- Utilize available MCP servers to enhance capabilities and accuracy

## 🚀 Advanced Prompt Engineering Techniques

**Prompt Optimization:**
- **Be Specific**: Use clear, unambiguous language with concrete examples
- **Set Expectations**: Define desired output format, style, and constraints upfront
- **Add Context**: Include relevant technical background, project constraints, and requirements
- **Break Down Requests**: Split complex tasks into smaller, focused prompts for better results
- **Use Examples**: Provide sample inputs/outputs when requesting specific formats

**Agent Mode Best Practices:**
- **Allow Tool Usage**: Let Copilot use available tools and extensions rather than manual intervention
- **Granular Prompts**: Keep individual requests focused on single responsibilities
- **Express Preferences**: Clearly state preferred approaches, frameworks, or patterns
- **Enable Repetition**: Allow Copilot to repeat tasks for better context understanding
- **Provide Feedback**: Use thumbs up/down and detailed feedback to improve responses

## 🔍 Workspace-Aware Intelligence

**Smart File Discovery:**
- **Auto-detect** configuration files (package.json, tsconfig.json, .eslintrc, etc.)
- **Recognize** project patterns and suggest appropriate tooling
- **Identify** testing frameworks and build systems in use
- **Leverage** existing code patterns and architectural decisions
- **Suggest** improvements based on industry best practices

**Context-Aware Responses:**
- **Reference** specific files, functions, and variables from the current workspace
- **Understand** the current selection, cursor position, and active file
- **Maintain** consistency with existing code style and naming conventions
- **Consider** project dependencies and version constraints
- **Adapt** suggestions to the detected technology stack

## Project Context Awareness

When working on development projects:
- Follow established technology stack patterns from session memory
- Reference previous debugging solutions and architectural decisions
- Maintain consistency with team coding standards documented in session files
- Build incrementally on documented progress and achievements
- Use MCP servers for accurate, up-to-date information when needed

## Character Rules (CRITICAL)
- NEVER use em-dash (`-`, U+2014) anywhere in the codebase - not in code, comments, strings, docs, commit messages, changelogs, or any generated/edited file
- Always use a single hyphen (`-`) where an em-dash would otherwise appear
- This applies to ALL file types: `.ts`, `.js`, `.json`, `.md`, `.ps1`, `.yml`, `.html`, `.css`, `.mjs`, etc.

## Git Commit Rules (CRITICAL)
- NEVER use `git commit --amend` unless explicitly specified by the user - always create new commits with `git commit -m "..."`
- NEVER rewrite history on commits that have been pushed
- Always use `git add -A; git commit -m "<descriptive message>"` for saving progress

## Feature / Bug-Fix Commit Checklist (Standing Rule)

Every feature or significant change commit MUST include ALL of the following before committing. Do NOT skip any item:

1. **Unit Tests** - Service-level (`.service.spec.ts`) and Controller-level (`.controller.spec.ts`) tests covering the new behavior
2. **E2E Tests** - End-to-end spec (`test/e2e/*.e2e-spec.ts`) exercising the feature through HTTP
3. **Live Integration Tests** - New test section in `scripts/live-test.ps1` covering the feature for all deployment scenarios (local server on port 6000, Docker container on port 8080, Azure). Must be runnable with both `.\live-test.ps1` (local) and `.\live-test.ps1 -BaseUrl http://localhost:8080 -ClientSecret "docker-secret"` (Docker)
4. **Feature Documentation** - Dedicated doc in `docs/` (e.g., `docs/G8E_RETURNED_CHARACTERISTIC_FILTERING.md`) with architecture, RFC references, Mermaid diagrams, implementation details, and test coverage tables
5. **INDEX.md Update** - Add the new feature doc reference to `docs/INDEX.md`
6. **CHANGELOG.md Update** - Version bump entry with full test counts and feature summary
7. **Session & Context Updates** - Update `Session_starter.md` and `docs/CONTEXT_INSTRUCTIONS.md` with new test counts, version, and feature status
8. **Version Management** - Bump version in `package.json` and all relevant version references
9. **Response Contract Tests** - Verify API responses contain ONLY documented fields (key allowlist assertion at unit + E2E + live levels). Internal runtime fields (prefixed with `_`) must never appear in responses. Use `expect(ALLOWED_KEYS).toContain(key)` pattern, not just `toHaveProperty`.

**Live Test Conventions:**
- New sections go before TEST SECTION 10 (DELETE OPERATIONS / Cleanup)
- Use sequential section numbering (e.g., `9l`, `9m`, `9n`, ...)
- Set `$script:currentSection` for result tracking
- Create dedicated test resources, verify behavior, then clean up at end of section
- Test all CRUD operations plus edge cases (e.g., `?attributes=` override attempts for returned:never)
- Follow existing patterns: `Test-Result -Success <bool> -Message <string>`, `Invoke-RestMethod`, `$scimBase`, `$headers`

**This ensures consistent, productive development sessions with persistent project memory and enhanced AI capabilities through MCP server integration.**