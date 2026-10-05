# Contributing to MCP Server Manager

Thank you for your interest in contributing to MCP Server Manager! This document provides guidelines and instructions for contributing to the project.

## Getting Started

### Prerequisites

- **Node.js** >= 20.0.0
- **npm** (comes with Node.js)
- **Git**

### Setting Up the Development Environment

1. **Fork and clone the repository:**

```bash
git clone https://github.com/YOUR_USERNAME/mcp-server-manager.git
cd mcp-server-manager
```

2. **Install dependencies:**

```bash
npm install
```

3. **Build the project:**

```bash
npm run build
```

4. **Run tests to verify everything works:**

```bash
npm test
```

## Development Workflow

### Running in Development Mode

- **CLI development mode** (with hot reload):

```bash
npm run dev
```

- **TUI development mode**:

```bash
npm run dev:tui
```

- **Documentation development mode**:

```bash
npm run docs:dev
```

### Code Quality

Before submitting a pull request, ensure your code passes all quality checks:

```bash
# Type checking
npm run typecheck

# Linting
npm run lint

# Formatting check
npm run format:check

# Run all tests
npm test
```

### Auto-fixing Issues

Many issues can be automatically fixed:

```bash
# Fix linting issues
npm run lint:fix

# Format code
npm run format
```

## Project Structure

```
mcp-server-manager/
├── src/
│   ├── cli/              # CLI command implementations
│   │   └── commands/     # Individual command files
│   ├── services/         # Business logic services
│   ├── shared/           # Shared utilities and helpers
│   ├── tui/              # Terminal UI components
│   │   ├── components/   # Reusable TUI components
│   │   ├── screens/      # TUI screen implementations
│   │   └── hooks/        # React hooks for TUI
│   └── types/            # TypeScript type definitions
├── tests/                # Test files
├── docs/                 # Documentation
└── dist/                 # Build output (gitignored)
```

## Making Changes

### 1. Create a Branch

Create a feature branch from `main`:

```bash
git checkout -b feature/your-feature-name
```

Or for bug fixes:

```bash
git checkout -b fix/your-bug-description
```

### 2. Make Your Changes

- Write clean, readable code
- Follow the existing code style
- Add comments for complex logic
- Keep functions focused and small
- Use TypeScript types appropriately

### 3. Write Tests

- Add tests for new features
- Update tests for modified features
- Ensure all tests pass: `npm test`
- Aim for good test coverage

### 4. Update Documentation

- Update relevant documentation in `docs/`
- Update CLI command documentation if you modify commands
- Update TUI documentation if you modify screens
- Keep the CHANGELOG.md updated (if applicable)

### 5. Commit Your Changes

Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```bash
git commit -m "feat: add new feature"
git commit -m "fix: resolve bug in client connection"
git commit -m "docs: update installation guide"
```

Common commit types:

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

### 6. Push and Create a Pull Request

```bash
git push origin feature/your-feature-name
```

Then create a pull request on GitHub with:

- A clear title and description
- Reference to any related issues
- Screenshots (for TUI changes)
- Testing instructions (if applicable)

## Code Style Guidelines

### TypeScript

- Use explicit return types for functions
- Avoid `any` types (use `unknown` if needed)
- Use strict TypeScript settings
- Prefer interfaces for object shapes
- Use type unions for discriminated unions

### Naming Conventions

- **Files**: Use kebab-case (e.g., `auth.service.ts`)
- **Functions/Variables**: Use camelCase (e.g., `getServerList`)
- **Types/Interfaces**: Use PascalCase (e.g., `ServerConfig`)
- **Constants**: Use UPPER_SNAKE_CASE (e.g., `DEFAULT_PORT`)

### Code Organization

- Keep functions focused on a single responsibility
- Extract complex logic into separate functions
- Group related functionality in services
- Use dependency injection where appropriate

### Error Handling

- Use proper error types
- Provide meaningful error messages
- Handle errors gracefully
- Log errors appropriately

## Testing Guidelines

### Writing Tests

- Write tests for all new features
- Test both success and error cases
- Use descriptive test names
- Keep tests isolated and independent
- Mock external dependencies

### Test Structure

```typescript
describe("FeatureName", () => {
  it("should do something specific", () => {
    // Arrange
    // Act
    // Assert
  });
});
```

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

## CLI/TUI Parity

This project maintains parity between CLI and TUI implementations. When adding features:

1. **CLI Commands**: Implement in `src/cli/commands/`
2. **TUI Screens**: Implement in `src/tui/screens/`
3. **Shared Logic**: Put in `src/services/` or `src/shared/`
4. **Update Documentation**: Keep `docs/cli/` and `docs/tui/` in sync

## Documentation

### CLI Documentation

- Update `docs/cli/` files when modifying commands
- Include examples in documentation
- Document all options and flags

### TUI Documentation

- Update `docs/tui/` files when modifying screens
- Document keyboard shortcuts
- Include screenshots when helpful

### Guide Documentation

- Update `docs/guide/` for user-facing guides
- Keep guides up-to-date with features
- Add troubleshooting tips when relevant

## Pull Request Process

1. **Ensure your code is ready:**
   - All tests pass
   - Code is linted and formatted
   - Documentation is updated
   - No TypeScript errors

2. **Create the PR:**
   - Use a descriptive title
   - Fill out the PR template (if available)
   - Link related issues
   - Add screenshots for UI changes

3. **Respond to feedback:**
   - Address review comments
   - Make requested changes
   - Keep discussions constructive

4. **After approval:**
   - Maintainers will merge your PR
   - Your contribution will be included in the next release

## Reporting Issues

### Bug Reports

When reporting bugs, please include:

- **Description**: Clear description of the bug
- **Steps to Reproduce**: Detailed steps to reproduce
- **Expected Behavior**: What should happen
- **Actual Behavior**: What actually happens
- **Environment**: OS, Node.js version, etc.
- **Logs**: Relevant error messages or logs

### Feature Requests

For feature requests, please include:

- **Use Case**: Why this feature would be useful
- **Proposed Solution**: How you envision it working
- **Alternatives**: Other solutions you've considered

## Questions?

- Check the [documentation](https://sardine-ai.github.io/mcp-server-manager/docs/guide/getting-started)
- Search existing [issues](https://github.com/sardine-ai/mcp-server-manager/issues)
- Open a new issue for questions or discussions

## Code of Conduct

- Be respectful and inclusive
- Welcome newcomers and help them learn
- Focus on constructive feedback
- Respect different opinions and approaches

Thank you for contributing to MCP Server Manager! 🎉
