//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { useAuth } from '@/hooks/auth.context';

/** "nitej.mithinti@bizmetric.com" → "Nitej" */
function firstName(email?: string): string {
  const local = (email ?? '').split('@')[0] ?? '';
  const first = local.split(/[._\s-]+/).find(Boolean) ?? '';
  return first ? first[0].toUpperCase() + first.slice(1) : 'there';
}

// Shown only after sign-in: the AuthGate in Root renders the Fabric login page first.
function App() {
  const { session } = useAuth();
  const email = session?.user?.email;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <section className="w-full max-w-md rounded-xl border border-border bg-card p-8 text-center shadow-sm">
        <h1 className="text-3xl font-bold">Welcome, {firstName(email)}</h1>
        {email ? <p className="mt-2 text-sm text-muted-foreground">Signed in as {email}</p> : null}
        <div className="mt-8 rounded-lg border border-dashed border-border p-6">
          <p className="font-medium">No data is available</p>
          <p className="mt-1 text-sm text-muted-foreground">ATLAS-DEV · Oxy ATLAS workspace</p>
        </div>
      </section>
    </main>
  );
}

export default App;
