//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { AppShell } from '@/app/app-shell.component';
import { ProfileProvider } from '@/app/profile.provider';

// Rendered only after sign-in: AuthGate in Root handles the login page.
// The profile (who is signed in, what they may do) is loaded once for the whole app.
function App() {
  return (
    <ProfileProvider>
      <AppShell />
    </ProfileProvider>
  );
}

export default App;
