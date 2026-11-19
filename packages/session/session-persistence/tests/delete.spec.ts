/** The base persistence contract's permanent-deletion refusal. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished } from 'vitest'
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import SessionPersistence, {
  SessionPersistenceDeleteUnsupportedError,
  type SessionAccess,
  type SessionHandle,
  type SessionPersistenceCreateOptions,
  type SessionPersistenceDeleteOptions,
  type SessionPersistenceListOptions,
  type SessionPersistenceOpenOptions,
  type SessionPersistenceSnapshot,
  type SessionPersistenceStatOptions,
} from '../src/index.ts'

/** A backend that implements only the required reads and writes and does not opt into deletion. */
class NoDeletionBackend extends SessionPersistence {
  create(_header: SessionHeader, _options?: SessionPersistenceCreateOptions): Promise<SessionHandle> {
    return Promise.reject(new Error('unused create'))
  }

  open(_id: SessionId, _access: SessionAccess, _options?: SessionPersistenceOpenOptions): Promise<SessionHandle> {
    return Promise.reject(new Error('unused open'))
  }

  flush(): Promise<void> {
    return Promise.resolve()
  }

  stat(_id: SessionId, _options?: SessionPersistenceStatOptions): Promise<SessionPersistenceSnapshot | undefined> {
    return Promise.resolve(undefined)
  }

  list(_options?: SessionPersistenceListOptions): Promise<readonly SessionPersistenceSnapshot[]> {
    return Promise.resolve([])
  }
}

describe('SessionPersistence.delete', () => {
  it('refuses by default so a backend must opt into permanent removal', async () => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    const backend = new NoDeletionBackend(ctx)
    const options: SessionPersistenceDeleteOptions = {}

    await expect(backend.delete('session-id' as SessionId, options))
      .rejects.toBeInstanceOf(SessionPersistenceDeleteUnsupportedError)
  })
})
