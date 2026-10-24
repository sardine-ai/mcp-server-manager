/**
 * DoctorScreen - System health check (ink component)
 */

import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import Spinner from "ink-spinner";
import { ScreenLayout } from "../components/index.js";
import { runDoctorChecks } from "../../services/doctor.service.js";
import { useTheme } from "../theme/index.js";

interface DoctorScreenProps {
  onBack: () => void;
}

export function DoctorScreen({ onBack }: DoctorScreenProps): React.ReactElement {
  const { theme } = useTheme();
  const [checks, setChecks] = useState<ReturnType<typeof runDoctorChecks>>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Run health checks on mount
  useEffect(() => {
    setChecks(runDoctorChecks());
    setIsLoading(false);
  }, []);

  // Handle keyboard input
  useInput(() => {
    if (!isLoading) {
      onBack();
    }
  });

  if (isLoading) {
    return (
      <ScreenLayout
        title="System Health Check"
        shortcuts={[{ key: "Any", label: "Go back" }]}
      >
        <Box paddingY={1} gap={1}>
          <Text color={theme.colors.info}>
            <Spinner type="dots" />
          </Text>
          <Text>Running health checks...</Text>
        </Box>
      </ScreenLayout>
    );
  }

  const allOk = checks.every((c) => c.status || c.name.includes("uv"));

  return (
    <ScreenLayout
      title="System Health Check"
      shortcuts={[{ key: "Any", label: "Go back" }]}
      footer={
        allOk ? (
          <Text color={theme.colors.success}>✓ All checks passed!</Text>
        ) : (
          <Text color={theme.colors.warning}>⚠ Some checks failed. See above for details.</Text>
        )
      }
    >
      {checks.map((check) => (
        <Box key={check.name} gap={1} marginBottom={1}>
          <Text color={check.status ? theme.colors.success : theme.colors.warning}>{check.status ? "✓" : "✗"}</Text>
          <Text>{check.name}:</Text>
          <Text color={check.status ? theme.colors.success : theme.colors.warning}>{check.info}</Text>
        </Box>
      ))}
    </ScreenLayout>
  );
}

export default DoctorScreen;
