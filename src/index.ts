import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin/tool"
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import { join, dirname } from "path"
import { homedir } from "os"

export type SaySettings = {
  enabled: boolean
  voice?: string
  rate?: number
  maxLength?: number
}

const DEFAULT_SETTINGS: SaySettings = {
  enabled: false,
  maxLength: 500,
}

function getSettingsPath(directory: string, global: boolean = false): string {
  if (global) {
    return join(homedir(), ".config", "opencode", "say-settings.json")
  }
  return join(directory, ".opencode", "say-settings.json")
}

function loadSettings(directory: string): SaySettings {
  // Try project settings first, then global
  const projectPath = getSettingsPath(directory, false)
  const globalPath = getSettingsPath(directory, true)

  for (const path of [projectPath, globalPath]) {
    if (existsSync(path)) {
      try {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(readFileSync(path, "utf-8")) }
      } catch {
        continue
      }
    }
  }
  return DEFAULT_SETTINGS
}

function saveSettings(directory: string, settings: SaySettings, global: boolean = false) {
  const path = getSettingsPath(directory, global)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(settings, null, 2))
}

export const SayPlugin: Plugin = async (ctx) => {
  return {
    tool: {
      say_toggle: tool({
        description:
          "Toggle speech mode on or off. When enabled, AI responses are spoken aloud using text-to-speech. Returns the new state.",
        args: {},
        async execute() {
          const settings = loadSettings(ctx.directory)
          settings.enabled = !settings.enabled
          saveSettings(ctx.directory, settings)
          return settings.enabled
            ? "Speech mode enabled. AI responses will now be spoken aloud."
            : "Speech mode disabled."
        },
      }),

      say_config: tool({
        description:
          "Configure text-to-speech settings. Available options: voice (string), rate (number, words per minute), maxLength (number, max characters to speak).",
        args: {
          voice: tool.schema.string().optional().describe("Voice name (e.g., 'Samantha', 'Daniel')"),
          rate: tool.schema.number().optional().describe("Speech rate in words per minute"),
          maxLength: tool.schema.number().optional().describe("Maximum characters to speak before truncating"),
          global: tool.schema.boolean().optional().describe("Save to global config instead of project"),
        },
        async execute(args) {
          const settings = loadSettings(ctx.directory)

          if (args.voice !== undefined) settings.voice = args.voice
          if (args.rate !== undefined) settings.rate = args.rate
          if (args.maxLength !== undefined) settings.maxLength = args.maxLength

          saveSettings(ctx.directory, settings, args.global ?? false)

          return `Settings updated: ${JSON.stringify(settings, null, 2)}`
        },
      }),

      say_status: tool({
        description: "Check the current text-to-speech settings and status.",
        args: {},
        async execute() {
          const settings = loadSettings(ctx.directory)
          return `Speech mode: ${settings.enabled ? "enabled" : "disabled"}\nVoice: ${settings.voice ?? "system default"}\nRate: ${settings.rate ?? "default"}\nMax length: ${settings.maxLength ?? 500} characters`
        },
      }),
    },

    "experimental.text.complete": async (input, output) => {
      const settings = loadSettings(ctx.directory)
      if (!settings.enabled) return

      const text = output.text.trim()
      if (text.length < 10) return

      const maxLength = settings.maxLength ?? 500
      const toSpeak =
        text.length > maxLength ? text.slice(0, maxLength) + "... message truncated" : text

      // Escape for shell
      const escaped = toSpeak.replace(/'/g, "'\\''")

      // Build say command with options
      const voiceArg = settings.voice ? `-v '${settings.voice}'` : ""
      const rateArg = settings.rate ? `-r ${settings.rate}` : ""

      // Run async, don't block
      ctx.$`say ${voiceArg} ${rateArg} '${escaped}'`.catch(() => {})
    },
  }
}

export default SayPlugin
