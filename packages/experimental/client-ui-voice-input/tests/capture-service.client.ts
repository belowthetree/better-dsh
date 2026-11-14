/** Controllable stand-in for the shared capture service used by the voice-input specs. */
import { vi, type Mock } from 'vitest'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { MicrophoneDevice, VoiceCapture, VoiceCaptureCatalog, VoiceCaptureFailure, VoiceCapturePreview,
  VoiceCaptureResult, VoiceCaptureSnapshot } from '@deepseek-ai/dsh-client-voice-capture/client'
import type { SpeechPreparationOptions, SpeechProviderId, SpeechSelectionPatch } from '@deepseek-ai/dsh-experimental-speech-to-text/types'

/** Selected recognizer used by every fixture catalog. */
export const PROVIDER = 'sensevoice-local' as SpeechProviderId

/** Host catalog the fake service reports. */
export const CATALOG: VoiceCaptureCatalog = {
  providers: [{ id: PROVIDER, name: 'SenseVoiceSmall', location: 'host-local', languages: ['auto', 'zh', 'en', 'ja'], preparation: { phase: 'ready' } }],
  selection: { providerId: PROVIDER, language: 'auto' },
  maxAudioBytes: 4 * 1024 * 1024,
  maxDurationSeconds: 120,
}

/** Idle observation the fake service starts from. */
export const IDLE_SNAPSHOT: VoiceCaptureSnapshot = {
  phase: 'idle', device: { id: '', label: '' }, level: 0, failure: null,
  maxDurationSeconds: 120, selection: CATALOG.selection, pendingTranscript: null,
}

/**
 * Publish the store's values to one follower until the signal aborts.
 * @param store - observed snapshot store.
 * @param signal - follower lifetime.
 * @returns the current snapshot and every later change.
 */
async function* watch(store: SnapshotStore<VoiceCaptureSnapshot>, signal: AbortSignal): AsyncIterable<VoiceCaptureSnapshot> {
  let wake: (() => void) | undefined
  const stop = (): void => { wake?.() }
  const unsubscribe = store.subscribe(() => { wake?.() })
  signal.addEventListener('abort', stop, { once: true })
  try {
    yield store.getSnapshot()
    while (!signal.aborted) {
      await new Promise<void>((resolve) => { wake = resolve })
      wake = undefined
      if (signal.aborted) return
      yield store.getSnapshot()
    }
  } finally {
    signal.removeEventListener('abort', stop)
    unsubscribe()
  }
}

/**
 * Follow the given catalogs, then either fail or wait for the observation to abort.
 * @param catalogs - catalogs to publish.
 * @param failure - rejection after the last catalog, when one is configured.
 * @param signal - observation lifetime.
 * @returns the catalog sequence.
 */
async function* catalogStream(catalogs: readonly VoiceCaptureCatalog[], failure: unknown,
  signal: AbortSignal): AsyncIterable<VoiceCaptureCatalog> {
  for (const catalog of catalogs) yield catalog
  if (failure !== undefined) throw failure
  await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
}

/** One preview handle with controllable level and release state. */
export interface FakePreview extends VoiceCapturePreview {
  /** Microphone the handle was acquired for. */
  readonly device: { readonly id: string; readonly label: string }
  /** Lifetime the picker handed to the service. */
  readonly signal: AbortSignal
  /** Interruption callback the picker passed. */
  onFailure: ((failure: VoiceCaptureFailure) => void) | undefined
  /** Whether the picker released the handle. */
  disposed: boolean
  /** Level reported while the frame loop runs. */
  current: number
}

/** One vi mock that keeps the operation signature it stands in for. */
type OperationMock<T extends (...args: never[]) => unknown> = Mock<(...args: Parameters<T>) => ReturnType<T>>

/** Mock handles for the service operations the specs assert. */
export interface FakeCaptureCalls {
  /** Device preference command. */
  readonly setDevice: OperationMock<VoiceCapture['setDevice']>
  /** Capture start command. */
  readonly begin: OperationMock<VoiceCapture['begin']>
  /** Capture stop and transcribe command. */
  readonly finish: OperationMock<VoiceCapture['finish']>
  /** Capture discard command. */
  readonly cancel: OperationMock<VoiceCapture['cancel']>
  /** Preview acquisition command. */
  readonly preview: OperationMock<VoiceCapture['preview']>
  /** Preference write command. */
  readonly configure: OperationMock<VoiceCapture['configure']>
  /** Preparation command. */
  readonly prepare: OperationMock<VoiceCapture['prepare']>
  /** Preparation cancellation command. */
  readonly cancelPreparation: OperationMock<VoiceCapture['cancelPreparation']>
}

/** Controllable capture service double. */
export interface FakeCapture {
  /** Structurally complete service the plugin injects. */
  readonly capture: VoiceCapture
  /** Mock handles for the operations above. */
  readonly calls: FakeCaptureCalls
  /** Store the specs mutate to publish snapshots. */
  readonly snapshots: SnapshotStore<VoiceCaptureSnapshot>
  /** Preview handles returned by the service double. */
  readonly previews: FakePreview[]
}

/**
 * Build one capture service double.
 * @param options - initial snapshot, catalog sequence, catalog failure, and preview behavior.
 * @returns the service, its snapshot store, and every created preview.
 */
export function fakeCapture(options: {
  snapshot?: VoiceCaptureSnapshot
  catalogs?: readonly VoiceCaptureCatalog[]
  catalogFailure?: unknown
  previewFailure?: unknown
  previewPending?: Promise<void>
} = {}): FakeCapture {
  const snapshots = createSnapshotStore<VoiceCaptureSnapshot>(options.snapshot ?? IDLE_SNAPSHOT)
  const previews: FakePreview[] = []
  const takeTranscript = (): string | null => {
    const pending = snapshots.getSnapshot().pendingTranscript
    if (pending === null) return null
    snapshots.set({ ...snapshots.getSnapshot(), pendingTranscript: null })
    return pending
  }
  const calls: FakeCaptureCalls = {
    setDevice: vi.fn<(device: MicrophoneDevice) => void>(),
    begin: vi.fn(async () => {}),
    finish: vi.fn(async (): Promise<VoiceCaptureResult> => ({ text: '', audioSeconds: 0, inferenceSeconds: 0 })),
    cancel: vi.fn(async () => {}),
    configure: vi.fn(async (_patch: SpeechSelectionPatch) => {}),
    prepare: vi.fn(async (_providerId: SpeechProviderId, _options?: SpeechPreparationOptions) => {}),
    cancelPreparation: vi.fn(async (_providerId: SpeechProviderId) => {}),
    preview: vi.fn(async (device: MicrophoneDevice, onFailure: (failure: VoiceCaptureFailure) => void,
      signal: AbortSignal): Promise<VoiceCapturePreview> => {
      if (options.previewFailure !== undefined) throw options.previewFailure
      if (options.previewPending) await options.previewPending
      const handle: FakePreview = {
        device, signal, onFailure, disposed: false, current: 0.25,
        level: () => handle.current,
        deviceInfo: () => ({ label: 'Fixture microphone', groupId: 'fixture-input' }),
        dispose: async () => { handle.disposed = true },
      }
      previews.push(handle)
      return handle
    }),
  }
  const capture: VoiceCapture = {
    snapshot: () => snapshots.getSnapshot(),
    follow: signal => watch(snapshots, signal),
    begin: calls.begin,
    finish: calls.finish,
    cancel: calls.cancel,
    takeTranscript,
    setDevice: calls.setDevice,
    configure: calls.configure,
    prepare: calls.prepare,
    cancelPreparation: calls.cancelPreparation,
    catalog: vi.fn(async () => CATALOG),
    followCatalog: signal => catalogStream(options.catalogs ?? [CATALOG], options.catalogFailure, signal),
    preview: calls.preview,
  }
  return { capture, calls, snapshots, previews }
}
