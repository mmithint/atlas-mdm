import { Copy } from 'lucide-react';
import { useState } from 'react';

import { button } from '@/components/ui';

import { useProfile } from './profile.context';

/**
 * Tells the person when their profile is not what they expect, in plain words:
 * the profile could not be loaded, or they are signed in but not registered yet.
 * Reading data is open to every signed-in person (POC-APP-04), so neither blocks the app.
 */
export function ProfileNotice() {
  const { state, reload } = useProfile();
  const [copied, setCopied] = useState(false);

  if (state.status === 'error') {
    return (
      <div role="alert" className="border-b border-border bg-warning px-400 py-200 text-300 text-warning-foreground">
        Your roles could not be loaded, so the menu may be incomplete. {state.message}{' '}
        <button type="button" onClick={reload} className="font-medium underline underline-offset-2">
          Try again
        </button>
      </div>
    );
  }

  if (state.status === 'ready' && state.profile.status === 'NOT_REGISTERED') {
    const id = state.profile.userId;
    const copy = async () => {
      if (!id) return;
      try {
        await navigator.clipboard.writeText(id);
        setCopied(true);
      } catch {
        setCopied(false); // clipboard blocked: the id is on screen to copy by hand
      }
    };
    return (
      <div role="status" className="border-b border-border bg-info px-400 py-200 text-300 text-info-foreground">
        <p>
          You are signed in, but an administrator has not linked your account to ATLAS yet. You can search and view heaters; you cannot raise or approve requests until then.
        </p>
        {id ? (
          <p className="mt-100 flex flex-wrap items-center gap-200">
            Send this id to an administrator: <span className="id-plate">{id}</span>
            <button type="button" className={button.small} onClick={() => void copy()}>
              <Copy aria-hidden="true" className="icon-size-100" />
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button type="button" className={button.small} onClick={reload}>
              I was added: check again
            </button>
          </p>
        ) : null}
      </div>
    );
  }

  if (state.status === 'ready' && state.profile.status === 'NOT_AUTHENTICATED') {
    return (
      <div role="alert" className="border-b border-border bg-warning px-400 py-200 text-300 text-warning-foreground">
        The server could not tell who you are. Sign out and in again, then reload the page.
      </div>
    );
  }

  return null;
}
