//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { Notes } from '@/components/notes.component';
import { Spikes } from '@/features/spikes/spikes.component';
import { useAuth } from '@/hooks/auth.context';
import { useHashRoute } from '@/hooks/use-hash-route';

// Rendered only after sign-in: AuthGate in Root handles the login page.
function App() {
  const { session } = useAuth();
  const email = session?.user?.email;
  const route = useHashRoute();

  return (
    <main className="min-h-screen bg-background p-500 text-foreground">
      <div className="mx-auto max-w-4xl">
        <header className="mb-500">
          <h1 className="text-3xl font-bold">
            {route === 'spikes' ? 'APP-0 spikes' : 'Notes'}
          </h1>
          {email ? (
            <p className="text-muted-foreground">Signed in as {email}</p>
          ) : null}
          {/* Temporary navigation until the app shell lands in APP-2. */}
          <nav aria-label="Temporary pages" className="mt-300 flex gap-400">
            <a href="#/" className="underline" aria-current={route === 'notes' ? 'page' : undefined}>
              Notes
            </a>
            <a href="#/spikes" className="underline" aria-current={route === 'spikes' ? 'page' : undefined}>
              Spikes (temporary)
            </a>
          </nav>
        </header>
        {route === 'spikes' ? <Spikes /> : <Notes email={email} />}
      </div>
    </main>
  );
}

export default App;
