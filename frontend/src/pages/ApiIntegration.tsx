import { CopyButton } from '../components/ui/CopyButton'
import { useAuth } from '../context/AuthContext'

export function ApiIntegration() {
  const { selectedTenantId } = useAuth()
  const tenantPlaceholder = selectedTenantId || '<TENANT_ID>'

  const createSessionSnippet = `curl -X POST http://localhost:8000/api/sessions \\
  -H "Authorization: Bearer $VOICELOCK_OPERATOR_JWT" \\
  -H "Content-Type: application/json" \\
  -d '{
    "tenant_id": "${tenantPlaceholder}",
    "user_id": "<USER_ID>",
    "requested_action": "sim_replacement",
    "resource_reference": "SIM-REQ-90412"
  }'`

  const challengeAndVerifySnippet = `# 1. Issue fresh single-use challenge
curl -X POST http://localhost:8000/api/sessions/<SESSION_ID>/challenge \\
  -H "Authorization: Bearer $VOICELOCK_OPERATOR_JWT"

# 2. Submit caller audio against challenge_id
curl -X POST http://localhost:8000/api/sessions/<SESSION_ID>/verify \\
  -H "Authorization: Bearer $VOICELOCK_OPERATOR_JWT" \\
  -F "challenge_id=<CHALLENGE_ID>" \\
  -F "file=@caller-response.wav"`

  const consumeTokenSnippet = `# Protected downstream app validates & consumes one-time token BEFORE acting
curl -X POST http://localhost:8000/api/tokens/consume \\
  -H "Authorization: Bearer $VOICELOCK_OPERATOR_JWT" \\
  -H "Content-Type: application/json" \\
  -d '{
    "token": "vl_tok_...",
    "tenant_id": "${tenantPlaceholder}",
    "user_id": "<USER_ID>",
    "action": "sim_replacement",
    "resource_reference": "SIM-REQ-90412"
  }'`

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">External Application Integration API</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Connect telecom, IT helpdesk, banking, or education systems to VoiceLock before executing sensitive actions.
          </p>
        </div>
        <a
          href="http://localhost:8000/docs"
          target="_blank"
          rel="noreferrer"
          className="rounded-full bg-zinc-950 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-800 transition-colors"
        >
          Open Swagger / OpenAPI Docs
        </a>
      </div>

      <div className="grid grid-cols-1 gap-5">
        <SnippetCard
          step="Step 1 · Create Action-Bound Verification Session"
          description="Bind the request to tenant_id, user_id, requested_action, and resource_reference."
          code={createSessionSnippet}
        />
        <SnippetCard
          step="Step 2 · Issue Fresh Challenge & Submit Audio"
          description="VoiceLock invokes faster-whisper + Detectif.ai Aletheia + Detectif.ai Eidos per industry policy."
          code={challengeAndVerifySnippet}
        />
        <SnippetCard
          step="Step 3 · Validate & Consume One-Time Decision Token"
          description="Your protected backend must atomically consume the token server-side before executing the sensitive operation."
          code={consumeTokenSnippet}
        />
      </div>
    </div>
  )
}

function SnippetCard({ step, description, code }: { step: string; description: string; code: string }) {
  return (
    <div className="vl-surface rounded-2xl p-5 sm:p-6 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-950">{step}</h2>
          <p className="text-xs text-zinc-500 mt-0.5">{description}</p>
        </div>
        <CopyButton text={code} label={`Copy ${step}`} />
      </div>
      <pre className="rounded-xl bg-zinc-950 text-zinc-100 p-4 text-xs font-mono overflow-x-auto border border-zinc-800">
        <code>{code}</code>
      </pre>
    </div>
  )
}
