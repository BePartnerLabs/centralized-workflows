// Mueve a "Released" las historias cerradas por los PRs de un release, en un
// GitHub Project (v2).
//
//   node scripts/release-to-project.mjs <tag> [--dry-run]
//   node scripts/release-to-project.mjs --bump <issue>   (Work type = Bump [+ Site])
//
// Lo corre `.github/workflows/release-to-project.yml` (workflow_call). Toda la
// configuracion llega por entorno y los IDs del project se resuelven por nombre
// al ejecutarse, asi un project recreado o copiado sigue funcionando:
//
//   GITHUB_REPOSITORY   owner/repo de los PRs y el release (obligatorio)
//   PROJECT_OWNER       login de la organizacion o usuario duenio del project
//   PROJECT_NUMBER      numero del project
//   STATUS_FIELD        campo de estado          (por defecto "Status")
//   RELEASED_OPTION     opcion de ese campo      (por defecto "Released")
//   WORK_TYPE_FIELD     solo --bump              (por defecto "Work type")
//   BUMP_OPTION         solo --bump              (por defecto "Bump")
//   SITE_FIELD          solo --bump              (por defecto "Site")
//   SITE_OPTION         solo --bump; vacio = no toca Site
//
// Las funciones puras se exportan para probarlas sin red; el resto habla con
// GitHub a traves de `gh` (toma GH_TOKEN del entorno, o la sesion local).
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/** Numeros de PR de los asuntos de commit: el squash-merge termina en `(#123)`. */
export function prNumbersFromCommits(messages) {
  const found = new Set()
  for (const message of messages) {
    const subject = String(message).split('\n')[0]
    const match = subject.match(/\(#(\d+)\)\s*$/)
    if (match) found.add(Number(match[1]))
  }
  return [...found].sort((a, b) => a - b)
}

const semver = (tag) => {
  const m = String(tag).match(/^v?(\d+)\.(\d+)\.(\d+)/)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

const compareSemver = (a, b) => {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]
  return 0
}

/** El mayor tag (por semver, no por fecha) estrictamente menor que `current`. */
export function previousTag(tags, current) {
  const target = semver(current)
  if (!target) return null
  const older = tags
    .map((tag) => ({ tag, v: semver(tag) }))
    .filter((t) => t.v && compareSemver(t.v, target) < 0)
    .sort((a, b) => compareSemver(b.v, a.v))
  return older[0]?.tag ?? null
}

/** Ya hay un comentario `Released in <tag>`? Acepta strings u objetos con `body`. */
export function alreadyCommented(comments, tag) {
  const needle = `Released in ${tag}`
  return comments.some((c) => String(typeof c === 'string' ? c : c?.body).includes(needle))
}

/**
 * Busca un campo single-select y una de sus opciones por nombre (sin distinguir
 * mayusculas). Devuelve `{ field, option }` con los IDs, o lanza un error que
 * lista lo que si existe, para que el typo se vea en el log.
 */
export function resolveOption(fields, fieldName, optionName) {
  const norm = (s) => String(s).trim().toLowerCase()
  const field = fields.find((f) => f?.options && norm(f.name) === norm(fieldName))
  if (!field) {
    const names = fields.filter((f) => f?.options).map((f) => f.name)
    throw new Error(
      `el project no tiene un campo single-select "${fieldName}" (hay: ${names.join(', ') || '-'})`,
    )
  }
  const option = field.options.find((o) => norm(o.name) === norm(optionName))
  if (!option) {
    throw new Error(
      `el campo "${field.name}" no tiene la opcion "${optionName}" (hay: ${field.options.map((o) => o.name).join(', ')})`,
    )
  }
  return { field: field.id, option: option.id }
}

const env = (name, fallback) => {
  const value = process.env[name]
  return value === undefined || value === '' ? fallback : value
}

const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

const graphql = (query, variables) => {
  const args = ['api', 'graphql', '-f', `query=${query}`]
  for (const [key, value] of Object.entries(variables)) {
    args.push(typeof value === 'number' ? '-F' : '-f', `${key}=${value}`)
  }
  return JSON.parse(gh(args)).data
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

const PROJECT_FIELDS = `
  id
  title
  fields(first: 100) {
    nodes {
      ... on ProjectV2SingleSelectField { id name options { id name } }
    }
  }`

const ORG_PROJECT = `query($owner: String!, $number: Int!) {
  organization(login: $owner) { projectV2(number: $number) { ${PROJECT_FIELDS} } }
}`

const USER_PROJECT = `query($owner: String!, $number: Int!) {
  user(login: $owner) { projectV2(number: $number) { ${PROJECT_FIELDS} } }
}`

/** owner + number -> { id, title, fields }. Prueba como organizacion y luego como usuario. */
export function loadProject(owner, number) {
  let project = null
  try {
    project = graphql(ORG_PROJECT, { owner, number }).organization?.projectV2
  } catch {
    // `organization(login:)` falla con un login de usuario; se reintenta abajo.
  }
  if (!project) {
    try {
      project = graphql(USER_PROJECT, { owner, number }).user?.projectV2
    } catch (error) {
      throw new Error(
        `no pude leer el project ${owner}#${number}: ${error.message.split('\n')[0]}. ` +
          'Revisa que el token tenga permiso de Projects sobre ese owner.',
      )
    }
  }
  if (!project) throw new Error(`no existe el project ${owner}#${number} (o el token no lo ve)`)
  return { id: project.id, title: project.title, fields: project.fields.nodes.filter(Boolean) }
}

function projectFromEnv() {
  const owner = env('PROJECT_OWNER')
  const number = Number(env('PROJECT_NUMBER'))
  if (!owner || !Number.isInteger(number) || number <= 0) {
    throw new Error('faltan PROJECT_OWNER y/o PROJECT_NUMBER')
  }
  return { ...loadProject(owner, number), label: `${owner}#${number}` }
}

const CLOSING_QUERY = `
query($owner: String!, $name: String!, $number: Int!, $statusField: String!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      closingIssuesReferences(first: 50) {
        nodes {
          number
          repository { nameWithOwner }
          comments(last: 100) { nodes { body } }
          projectItems(first: 20) {
            nodes {
              id
              project { id }
              status: fieldValueByName(name: $statusField) {
                ... on ProjectV2ItemFieldSingleSelectValue { name }
              }
            }
          }
        }
      }
    }
  }
}`

const SET_FIELD = `
mutation($project: ID!, $item: ID!, $field: ID!, $option: String!) {
  updateProjectV2ItemFieldValue(input: {
    projectId: $project, itemId: $item, fieldId: $field,
    value: { singleSelectOptionId: $option }
  }) { projectV2Item { id } }
}`

const ITEM_QUERY = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      projectItems(first: 20) { nodes { id project { id } } }
    }
  }
}`

const setSingleSelect = (projectId, itemId, { field, option }) =>
  graphql(SET_FIELD, { project: projectId, item: itemId, field, option })

const repoParts = () => {
  const repo = env('GITHUB_REPOSITORY')
  if (!repo || !repo.includes('/')) throw new Error('falta GITHUB_REPOSITORY (owner/repo)')
  const [owner, name] = repo.split('/')
  return { repo, owner, name }
}

/** Para dependency-review: Work type = Bump (y Site, si SITE_OPTION viene) en el issue. */
export function markIssueAsBump(number, { log = console.log, retries = 6, delayMs = 5000 } = {}) {
  const { owner, name } = repoParts()
  const project = projectFromEnv()
  const targets = [
    resolveOption(project.fields, env('WORK_TYPE_FIELD', 'Work type'), env('BUMP_OPTION', 'Bump')),
  ]
  const siteOption = env('SITE_OPTION')
  if (siteOption) targets.push(resolveOption(project.fields, env('SITE_FIELD', 'Site'), siteOption))

  // El auto-add del project puede tardar unos segundos tras crear el issue.
  let item
  for (let attempt = 0; attempt <= retries; attempt++) {
    const data = graphql(ITEM_QUERY, { owner, name, number })
    item = data.repository.issue.projectItems.nodes.find((n) => n.project.id === project.id)
    if (item || attempt === retries) break
    log(`issue #${number} aun no esta en ${project.label}; reintento en ${delayMs / 1000}s`)
    sleep(delayMs)
  }
  if (!item) throw new Error(`issue #${number} no esta en el project ${project.label}`)
  for (const target of targets) setSingleSelect(project.id, item.id, target)
  log(`issue #${number}: marcado como bump en ${project.label}`)
}

function releaseTags(repo) {
  const out = gh([
    'api',
    `repos/${repo}/releases`,
    '--paginate',
    '--jq',
    '.[] | select(.draft == false) | .tag_name',
  ])
  return out.split('\n').filter(Boolean)
}

/**
 * Mensajes de commit entre `previous` y `tag`. Sin `previous` (primer release)
 * toma todo el historial alcanzable desde `tag`.
 * --jq imprime cada mensaje tal cual (multilinea); prNumbersFromCommits solo mira
 * el asunto, y las lineas de cuerpo no terminan en `(#N)` del squash.
 */
function commitMessages(repo, previous, tag) {
  const path = previous
    ? `repos/${repo}/compare/${previous}...${tag}`
    : `repos/${repo}/commits?sha=${encodeURIComponent(tag)}&per_page=100`
  const jq = previous ? '.commits[].commit.message' : '.[].commit.message'
  return gh(['api', path, '--paginate', '--jq', jq]).split('\n').filter(Boolean)
}

export function run(tag, { dryRun = false, log = console.log } = {}) {
  const { repo, owner, name } = repoParts()
  const project = projectFromEnv()
  const statusField = env('STATUS_FIELD', 'Status')
  const releasedName = env('RELEASED_OPTION', 'Released')
  const released = resolveOption(project.fields, statusField, releasedName)

  const previous = previousTag(releaseTags(repo), tag)
  const prs = prNumbersFromCommits(commitMessages(repo, previous, tag))
  log(
    `${tag} (${previous ? `anterior ${previous}` : 'primer release: desde el inicio del historial'}): ` +
      `${prs.length} PR(s): ${prs.map((n) => `#${n}`).join(' ') || '-'} -> ${project.label} "${project.title}"`,
  )

  let attempted = 0
  let failed = 0
  for (const pr of prs) {
    let issues
    try {
      issues = graphql(CLOSING_QUERY, { owner, name, number: pr, statusField }).repository
        .pullRequest.closingIssuesReferences.nodes
    } catch (error) {
      log(`PR #${pr}: no pude leer sus issues (${error.message.split('\n')[0]})`)
      continue
    }
    if (issues.length === 0) {
      log(`PR #${pr}: sin issues vinculados, se omite`)
      continue
    }
    for (const issue of issues) {
      const label = `PR #${pr} -> issue #${issue.number}`
      const item = issue.projectItems.nodes.find((n) => n.project.id === project.id)
      if (!item) {
        log(`${label}: no esta en ${project.label}, se omite`)
        continue
      }
      const status = item.status?.name ?? '(sin status)'
      attempted++
      try {
        // El "Item closed" del project pone Done unos segundos despues de cerrar;
        // por eso se lee el estado real y no se asume.
        if (status.toLowerCase() === releasedName.toLowerCase()) {
          log(`${label}: ya esta en ${releasedName}`)
        } else if (dryRun) {
          log(`${label}: ${status} -> ${releasedName} (dry-run, no se escribe)`)
        } else {
          setSingleSelect(project.id, item.id, released)
          log(`${label}: ${status} -> ${releasedName}`)
        }
        if (alreadyCommented(issue.comments.nodes, tag)) {
          log(`${label}: ya tiene el comentario`)
        } else if (dryRun) {
          log(`${label}: comentaria "Released in ${tag}" (dry-run)`)
        } else {
          // El texto literal `Released in <tag>` es lo que alreadyCommented busca al reintentar.
          const body = `Released in ${tag}\n\nhttps://github.com/${repo}/releases/tag/${tag}`
          gh([
            'api',
            `repos/${issue.repository.nameWithOwner}/issues/${issue.number}/comments`,
            '-f',
            `body=${body}`,
          ])
          log(`${label}: comentado`)
        }
      } catch (error) {
        failed++
        log(`${label}: ERROR ${error.message.split('\n')[0]}`)
      }
    }
  }
  // Un fallo aislado no frena la corrida; solo falla el job si nada se pudo actualizar.
  return { attempted, failed }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [first, second] = process.argv.slice(2)
  try {
    if (first === '--bump') {
      const issue = Number(second)
      if (!Number.isInteger(issue) || issue <= 0) {
        console.error('uso: node scripts/release-to-project.mjs --bump <issue>')
        process.exit(2)
      }
      markIssueAsBump(issue)
      process.exit(0)
    }
    if (!first || first.startsWith('--')) {
      console.error('uso: node scripts/release-to-project.mjs <tag> [--dry-run]')
      process.exit(2)
    }
    const { attempted, failed } = run(first, { dryRun: process.argv.includes('--dry-run') })
    console.log(`${attempted} issue(s) tratados, ${failed} con error`)
    if (attempted > 0 && failed === attempted) process.exit(1)
  } catch (error) {
    console.error(`error: ${error.message}`)
    process.exit(1)
  }
}
