//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { createRoot } from 'react-dom/client';

import { Root } from './Root';
import { bootstrapAuth } from './services/rayfin-auth.service';

import './global.css';

// `npm run dev:mock` (Vite mode "mock"): sign in as an invented user and answer from invented data. The check is
// written out so the production build drops the branch; see src/dev-mock/.
const rayfinAuthService =
  import.meta.env.DEV && import.meta.env.MODE === 'mock'
    ? (await import('./dev-mock/mock-client')).createMockAuthService()
    : await bootstrapAuth();

createRoot(document.getElementById('root')!).render(
  <Root rayfinAuthService={rayfinAuthService} />
);
