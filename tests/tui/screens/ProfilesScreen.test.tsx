/**
 * ProfilesScreen Tests
 */

import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "../setup.js";
import { mockProfileService, waitForStateUpdate, KEYS } from "../setup.js";

// Setup mocks before importing component
vi.mock("../../../src/services/profile.service.js", () => ({
  getProfileService: vi.fn(() => mockProfileService),
}));

import { ProfilesScreen } from "../../../src/tui/screens/ProfilesScreen.js";

describe("ProfilesScreen", () => {
  const mockOnBack = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockProfileService.list.mockReturnValue([
      { id: "default", name: "Default", isActive: true, includesAll: true, serverCount: 0 },
      { id: "dev", name: "Development", isActive: false, includesAll: false, serverCount: 2 },
    ]);
    mockProfileService.create.mockReturnValue({ success: true });
    mockProfileService.clone.mockReturnValue({ success: true });
    mockProfileService.rename.mockReturnValue({ success: true });
    mockProfileService.delete.mockReturnValue({ success: true });
    mockProfileService.getServersForProfile.mockReturnValue({ servers: [], remoteServers: [] });
  });

  describe("Rendering", () => {
    it("should render profiles screen with title", () => {
      const { lastFrame } = render(<ProfilesScreen onBack={mockOnBack} />);

      expect(lastFrame()).toContain("Profiles");
    });

    it("should display existing profiles", () => {
      const { lastFrame } = render(<ProfilesScreen onBack={mockOnBack} />);

      expect(lastFrame()).toContain("Default");
      expect(lastFrame()).toContain("Development");
    });

    it("should show profile IDs when different from name", () => {
      const { lastFrame } = render(<ProfilesScreen onBack={mockOnBack} />);

      // "Default" → "default" matches ID, so [default] is hidden
      expect(lastFrame()).not.toContain("[default]");
      // "Development" → "development" ≠ "dev", so [dev] is shown
      expect(lastFrame()).toContain("[dev]");
    });

    it("should show server count for profiles", () => {
      const { lastFrame } = render(<ProfilesScreen onBack={mockOnBack} />);

      // Development profile has 2 servers
      expect(lastFrame()).toContain("2");
    });

    it("should display server previews and remaining count", () => {
      mockProfileService.getServersForProfile.mockReturnValueOnce({
        servers: [
          { id: "one", name: "One", command: "node", args: [] },
          { id: "two", name: "Two", command: "node", args: [] },
          { id: "three", name: "Three", command: "node", args: [] },
        ],
        remoteServers: [
          { id: "four", name: "Four", url: "https://four.example", type: "http" },
          { id: "five", name: "Five", url: "https://five.example", type: "sse" },
        ],
      });

      const { lastFrame } = render(<ProfilesScreen onBack={mockOnBack} />);

      expect(lastFrame()).toContain("One, Two, Three, Four, +1 more");
    });

    it("should show an empty state when no profiles exist", () => {
      mockProfileService.list.mockReturnValueOnce([]);

      const { lastFrame } = render(<ProfilesScreen onBack={mockOnBack} />);

      expect(lastFrame()).toContain("No profiles configured");
    });
  });

  describe("Navigation", () => {
    it("should call onBack when Q is pressed", () => {
      const { stdin } = render(<ProfilesScreen onBack={mockOnBack} />);

      stdin.write("q");

      expect(mockOnBack).toHaveBeenCalled();
    });

    it("should call onBack when ESC is pressed", () => {
      const { stdin } = render(<ProfilesScreen onBack={mockOnBack} />);

      stdin.write(KEYS.ESCAPE);

      expect(mockOnBack).toHaveBeenCalled();
    });

    it("should support keyboard navigation with arrow keys", () => {
      const { lastFrame, stdin } = render(<ProfilesScreen onBack={mockOnBack} />);

      // Initially first item should be selected
      const initialFrame = lastFrame();
      expect(initialFrame).toContain("→");

      // Press down arrow
      stdin.write(KEYS.DOWN);

      // Selection should move
      const afterDown = lastFrame();
      expect(afterDown).toContain("→");
    });
  });

  describe("Create Profile", () => {
    it("should show create profile view when A is pressed", async () => {
      const { lastFrame, stdin } = render(<ProfilesScreen onBack={mockOnBack} />);

      await waitForStateUpdate();
      // Press A to show clone confirmation
      stdin.write("a");
      await waitForStateUpdate();
      expect(lastFrame()).toContain("New Profile");

      // Choose "No, create empty" (press N for "No" to cloning)
      stdin.write("n");
      await waitForStateUpdate(300);

      expect(lastFrame()).toContain("Create New Profile");
      expect(lastFrame()).toContain("Profile name");
    });

    it("should go back from create view with ESC", async () => {
      const { stdin, lastFrame } = render(<ProfilesScreen onBack={mockOnBack} />);

      await waitForStateUpdate();
      // Open create view - first shows clone confirmation
      stdin.write("a");
      await waitForStateUpdate();
      expect(lastFrame()).toContain("New Profile");

      // Choose "Start fresh" (press N for "No" to cloning)
      stdin.write("n");
      await waitForStateUpdate();
      expect(lastFrame()).toContain("Create New Profile");

      // ESC should go back to list
      stdin.write(KEYS.ESCAPE);
      await waitForStateUpdate();

      expect(lastFrame()).toContain("Profiles");
      expect(lastFrame()).not.toContain("Create New Profile");
    });

    it("should show name input in create view", async () => {
      const { stdin, lastFrame } = render(<ProfilesScreen onBack={mockOnBack} />);

      await waitForStateUpdate();
      // Open create view - first shows clone confirmation
      stdin.write("a");
      await waitForStateUpdate();
      expect(lastFrame()).toContain("New Profile");

      // Choose "Start fresh" (press N for "No" to cloning)
      stdin.write("n");
      await waitForStateUpdate();

      // Should show input prompt
      expect(lastFrame()).toContain("Profile name");
    });

    it("should create a new empty profile from the form", async () => {
      const { stdin, lastFrame } = render(<ProfilesScreen onBack={mockOnBack} />);

      stdin.write("a");
      await waitForStateUpdate();
      stdin.write("n");
      await waitForStateUpdate();
      stdin.write("QA Profile");
      await waitForStateUpdate();
      stdin.write(KEYS.ENTER);
      await waitForStateUpdate();

      expect(mockProfileService.create).toHaveBeenCalledWith("qa-profile", "QA Profile");
      expect(lastFrame()).toContain("Profile 'QA Profile' created");
    });

    it("should clone from a selected source profile", async () => {
      const { stdin, lastFrame } = render(<ProfilesScreen onBack={mockOnBack} />);

      stdin.write("a");
      await waitForStateUpdate();
      stdin.write("y");
      await waitForStateUpdate();
      expect(lastFrame()).toContain("Select Profile to Clone");

      stdin.write(KEYS.DOWN);
      await waitForStateUpdate();
      stdin.write(KEYS.ENTER);
      await waitForStateUpdate();
      expect(lastFrame()).toContain("Clone Profile: Development");

      stdin.write("QA Clone");
      await waitForStateUpdate();
      stdin.write(KEYS.ENTER);
      await waitForStateUpdate();

      expect(mockProfileService.clone).toHaveBeenCalledWith("dev", "qa-clone", "QA Clone");
      expect(lastFrame()).toContain("Profile 'QA Clone' cloned");
    });

    it("should show a create failure message", async () => {
      mockProfileService.create.mockReturnValueOnce({
        success: false,
        error: "profile exists",
      });

      const { stdin, lastFrame } = render(<ProfilesScreen onBack={mockOnBack} />);

      stdin.write("a");
      await waitForStateUpdate();
      stdin.write("n");
      await waitForStateUpdate();
      stdin.write("Duplicate");
      await waitForStateUpdate();
      stdin.write(KEYS.ENTER);
      await waitForStateUpdate();

      expect(lastFrame()).toContain("profile exists");
    });
  });

  describe("Delete Profile", () => {
    it("should show delete confirmation when D is pressed", async () => {
      const { stdin, lastFrame } = render(<ProfilesScreen onBack={mockOnBack} />);

      await waitForStateUpdate();
      // Navigate to a non-active profile (can't delete active)
      stdin.write(KEYS.DOWN);
      await waitForStateUpdate();

      // Press D
      stdin.write("d");
      await waitForStateUpdate();

      // Should show confirmation
      expect(lastFrame()).toMatch(/delete|confirm/i);
    });

    it("should delete a non-active profile when confirmed", async () => {
      const { stdin, lastFrame } = render(<ProfilesScreen onBack={mockOnBack} />);

      stdin.write(KEYS.DOWN);
      await waitForStateUpdate();
      stdin.write("d");
      await waitForStateUpdate();
      stdin.write("y");
      await waitForStateUpdate();

      expect(mockProfileService.delete).toHaveBeenCalledWith("dev");
      expect(lastFrame()).toContain("Profile deleted");
    });
  });

  describe("Rename Profile", () => {
    it("should show rename view when R is pressed", async () => {
      const { stdin, lastFrame } = render(<ProfilesScreen onBack={mockOnBack} />);

      await waitForStateUpdate();
      // Press R to rename
      stdin.write("r");
      await waitForStateUpdate();

      expect(lastFrame()).toContain("Rename Profile");
    });

    it("should rename the selected profile when submitted", async () => {
      const { stdin, lastFrame } = render(<ProfilesScreen onBack={mockOnBack} />);

      stdin.write("r");
      await waitForStateUpdate();
      stdin.write(KEYS.ENTER);
      await waitForStateUpdate();

      expect(mockProfileService.rename).toHaveBeenCalledWith("default", "Default");
      expect(lastFrame()).toContain("Profile renamed to 'Default'");
    });

    it("should show a rename failure message", async () => {
      mockProfileService.rename.mockReturnValueOnce({
        success: false,
        error: "rename failed",
      });

      const { stdin, lastFrame } = render(<ProfilesScreen onBack={mockOnBack} />);

      stdin.write("r");
      await waitForStateUpdate();
      stdin.write(KEYS.ENTER);
      await waitForStateUpdate();

      expect(lastFrame()).toContain("rename failed");
    });
  });

  describe("Nested Navigation", () => {
    it("should support ESC to go back in nested views", async () => {
      const { stdin } = render(<ProfilesScreen onBack={mockOnBack} />);

      await waitForStateUpdate();
      // Press A to show clone confirmation
      stdin.write("a");
      await waitForStateUpdate();

      // ESC from confirmClone goes to create view (by calling onCancel)
      stdin.write(KEYS.ESCAPE);
      await waitForStateUpdate();

      // ESC from create view goes back to list
      stdin.write(KEYS.ESCAPE);
      await waitForStateUpdate();

      // ESC from list should call onBack
      stdin.write(KEYS.ESCAPE);
      await waitForStateUpdate();

      expect(mockOnBack).toHaveBeenCalledTimes(1);
    });
  });
});
