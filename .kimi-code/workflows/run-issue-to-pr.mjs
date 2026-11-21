#!/usr/bin/env node
// Kimi Code host for the deterministic /issue-to-pr workflow.
// Each stage is a fresh `kimi -p` process with an explicit agent file. The
// workflow core owns stage order; this file only supplies runtime primitives.

import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { runIssueToPr } from './issue-to-pr.mjs'

const ACTIVE_RELATIVE = path.join('artifacts', 'issue-to-pr', 'active.json')

export function validateSchema(value, schema, location = '$') {
  if (!schema) return
  if (schema.enum && !schema.enum.includes(value)) {
    throw new Error(`${location} must be one of ${schema.enum.join(', ')}`)
  }
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${location} must be an object`)
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) throw new Error(`${location}.${key} is required`)
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (Object.hasOwn(value, key)) validateSchema(value[key], child, `${location}.${key}`)
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) throw new Error(`${location} must be an array`)
    value.forEach((item, index) => validateSchema(item, schema.items, `${location}[${index}]`))
  } else if (schema.type === 'string' && typeof value !== 'string') {
    throw new Error(`${location} must be a string`)
  } else if (schema.type === 'boolean' && typeof value !== 'boolean') {
    throw new Error(`${location} must be a boolean`)
  } else if (schema.type === 'integer' && !Number.isInteger(value)) {
    throw new Error(`${location} must be an integer`)
  } else if (schema.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) {
    throw new Error(`${location} must be a number`)
  }
}

function textContent(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((part) => typeof part === 'string' ? part : (part?.text ?? '')).join('')
  }
  return ''
}

export function parseAgentOutput(stdout, schema) {
  const events = stdout.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
    try {
      return JSON.parse(line)
    } catch (error) {
      throw new Error(`Kimi emitted invalid stream-json on line ${index + 1}: ${error.message}`)
    }
  })
  const replies = events.filter((event) => event?.role === 'assistant' && event.content != null && !event.tool_calls)
  const text = textContent(replies.at(-1)?.content).trim()
  if (!text) throw new Error('Kimi returned no final assistant message')
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].at(-1)
  const candidate = fenced ? fenced[1].trim() : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  if (!candidate.startsWith('{')) throw new Error('Kimi returned no JSON object')
  let result
  try {
    result = JSON.parse(candidate)
  } catch (error) {
    throw new Error(`Kimi returned invalid result JSON: ${error.message}`)
  }
  validateSchema(result, schema)
  return result
}

function invokeKimi(root, children, prompt, options) {
  const agentFile = path.join(root, '.kimi-code', 'agents', `${options.agentType}.md`)
  if (!fs.existsSync(agentFile)) return Promise.reject(new Error(`Missing agent file: ${agentFile}`))
  const schemaPrompt = `${prompt}\n\nReturn only one JSON object matching this JSON Schema. Do not use a Markdown fence or add commentary.\n${JSON.stringify(options.schema)}`
  const args = ['--agent-file', agentFile, '--prompt', schemaPrompt, '--output-format', 'stream-json']
  return new Promise((resolve, reject) => {
    const child = spawn('kimi', args, { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    children.add(child)
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-16000)
      process.stderr.write(chunk)
    })
    child.on('error', (error) => {
      children.delete(child)
      reject(new Error(`Could not start Kimi Code: ${error.message}`))
    })
    child.on('close', (code) => {
      children.delete(child)
      if (code !== 0) return reject(new Error(`Kimi Code exited ${code}: ${stderr.trim()}`))
      try {
        resolve(parseAgentOutput(stdout, options.schema))
      } catch (error) {
        reject(new Error(`${options.label}: ${error.message}`))
      }
    })
  })
}

async function main() {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: process.cwd(), encoding: 'utf8' }).trim()
  const activePath = path.join(root, ACTIVE_RELATIVE)
  fs.mkdirSync(path.dirname(activePath), { recursive: true })
  try {
    fs.writeFileSync(activePath, '', { flag: 'wx' })
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    return {
      status: 'blocked',
      reason: 'run_already_active',
      next_step: `Another run may be active in this worktree. If no runner is alive, remove ${ACTIVE_RELATIVE} and rerun.`,
    }
  }

  const children = new Set()
  const writeState = (allowPush) => {
    const temporary = `${activePath}.${process.pid}.tmp`
    fs.writeFileSync(temporary, JSON.stringify({ active: true, pid: process.pid, allow_agent_branch_push: allowPush }))
    fs.renameSync(temporary, activePath)
  }
  const cleanup = () => {
    try { fs.unlinkSync(activePath) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  const interrupt = () => {
    for (const child of children) child.kill('SIGTERM')
    cleanup()
    process.exit(130)
  }
  process.on('SIGINT', interrupt)
  process.on('SIGTERM', interrupt)

  try {
    writeState(false)
    const agent = (prompt, options) => invokeKimi(root, children, prompt, options)
    const parallel = (thunks) => Promise.all(thunks.map((thunk) => thunk()))
    const phase = (title) => {
      writeState(title === 'Handoff')
      process.stderr.write(`\n[issue-to-pr] ${title}\n`)
    }
    const log = (message) => process.stderr.write(`[issue-to-pr] ${message}\n`)
    const args = process.argv.length === 3 ? process.argv[2] : undefined
    return await runIssueToPr(args, { agent, parallel, phase, log })
  } finally {
    process.removeListener('SIGINT', interrupt)
    process.removeListener('SIGTERM', interrupt)
    cleanup()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = await main()
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: 'blocked', reason: 'runner_error', next_step: 'Fix the runner error and rerun.', error: error.message }, null, 2)}\n`)
    process.exitCode = 1
  }
}
