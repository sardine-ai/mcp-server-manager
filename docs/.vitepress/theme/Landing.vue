<template>
  <div class="landing-page" ref="landingContainer"></div>
</template>

<script setup>
import { ref, onMounted, nextTick } from 'vue'

const landingContainer = ref(null)

onMounted(async () => {
  if (!landingContainer.value) return
  
  try {
    // Load the landing HTML from public folder
    const response = await fetch('/mcp-server-manager/landing.html')
    if (!response.ok) {
      console.error('Failed to fetch landing.html:', response.status)
      return
    }
    
    const html = await response.text()
    
    // Extract body content
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)
    if (bodyMatch) {
      landingContainer.value.innerHTML = bodyMatch[1]
      
      // Extract and inject styles
      const styleMatch = html.match(/<style>([\s\S]*)<\/style>/i)
      if (styleMatch) {
        const styleEl = document.createElement('style')
        styleEl.textContent = styleMatch[1]
        styleEl.id = 'landing-styles'
        // Remove existing if any
        const existing = document.getElementById('landing-styles')
        if (existing) existing.remove()
        document.head.appendChild(styleEl)
      }
      
      // Wait for DOM to be ready
      await nextTick()
      
      // Load Typed.js first, then execute scripts
      const executeScripts = () => {
        executeLandingScripts(html)
      }
      
      if (!window.Typed) {
        const typedScript = document.createElement('script')
        typedScript.src = 'https://unpkg.com/typed.js@2.1.0/dist/typed.umd.js'
        typedScript.onload = () => {
          setTimeout(executeScripts, 200)
        }
        document.head.appendChild(typedScript)
      } else {
        setTimeout(executeScripts, 200)
      }
    }
  } catch (error) {
    console.error('Failed to load landing page:', error)
    if (landingContainer.value) {
      landingContainer.value.innerHTML = '<div style="padding: 40px; text-align: center; color: #fff;">Failed to load landing page. Please check the console for errors.</div>'
    }
  }
})

function executeLandingScripts(html) {
  // Extract the ENTIRE script content (not just DOMContentLoaded part)
  const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/i)
  if (!scriptMatch) return
  
  let scriptContent = scriptMatch[1]
  
  // Replace DOMContentLoaded wrapper - extract the inner code and execute it immediately
  // Pattern: document.addEventListener('DOMContentLoaded', () => { ... })
  scriptContent = scriptContent.replace(
    /document\.addEventListener\s*\(\s*['"]DOMContentLoaded['"]\s*,\s*\(\)\s*=>\s*\{/g,
    '(function() {'
  )
  
  // Close the IIFE at the end
  scriptContent = scriptContent.replace(/\}\s*\)\s*;?\s*$/, '})()')
  
  try {
    // Execute the entire script (includes all function definitions)
    const scriptEl = document.createElement('script')
    scriptEl.textContent = scriptContent
    // Append to body to execute in global scope
    document.body.appendChild(scriptEl)
  } catch (error) {
    console.error('Error executing landing scripts:', error)
  }
}
</script>

<style scoped>
.landing-page {
  margin-top: 0;
  padding-top: 0;
  min-height: 100vh;
}
</style>
