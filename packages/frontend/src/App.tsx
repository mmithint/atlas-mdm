//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { Notes } from '@/components/notes.component';
import { useAuth } from '@/hooks/auth.context';

// Rendered only after sign-in: AuthGate in Root handles the login page.
function App() {
  const { session } = useAuth();
  const email = session?.user?.email;

  return (
    <main className="min-h-screen bg-background p-500 text-foreground">
      <div className="mx-auto max-w-4xl">
        <header className="mb-500">
          <h1 className="text-3xl font-bold">Notes</h1>
          {email ? (
            <p className="text-muted-foreground">Signed in as {email}</p>
          ) : null}
        </header>
        <Notes email={email} />
      </div>
    </main>
  );
}

export default App;
