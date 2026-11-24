//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { type ReactNode } from 'react';

import { button } from '@/components/ui';
import { useAuth } from '@/hooks/auth.context';

interface AuthGateProps {
  children: ReactNode;
}

export function AuthGate({ children }: AuthGateProps) {
  const {
    isLoading,
    isAuthenticated,
    canSignIn,
    signIn,
    isSigningIn,
    signInError,
    config,
    error,
  } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-300 leading-300 text-muted-foreground">
          Connecting to Fabric…
        </div>
      </div>
    );
  }

  if (config.kind === 'not-deployed') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-md text-center">
          <h2 className="mb-2 text-500 leading-500 font-semibold text-foreground">
            Configure this app to sign in
          </h2>
          <p className="mb-4 text-300 leading-300 text-muted-foreground">
            Signing in needs a Fabric backend. Start{' '}
            <code className="rounded bg-muted px-1 py-0.5">npm run dev</code>{' '}
            with an approved workspace, or deploy this app, then reload.
          </p>
        </div>
      </div>
    );
  }

  if (config.kind === 'incomplete') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-md text-center">
          <h2 className="mb-2 text-500 leading-500 font-semibold text-foreground">
            This app is missing its Rayfin configuration
          </h2>
          <p className="mb-4 text-300 leading-300 text-muted-foreground">
            The dev server started without {config.missing.join(', ')}. Check
            the warnings it printed, then restart it.
          </p>
        </div>
      </div>
    );
  }

  if (config.kind === 'config-error') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-md text-center">
          <h2 className="mb-2 text-500 leading-500 font-semibold text-foreground">
            Couldn't load this app's configuration
          </h2>
          <p className="mb-4 text-300 leading-300 text-muted-foreground">
            The app stopped rather than fall back to the values it was built
            with, which in a promoted environment point at the wrong backend.
            Redeploy this stage, then reload.
          </p>
          <p className="text-200 leading-200 text-muted-foreground">{config.message}</p>
        </div>
      </div>
    );
  }

  if (error && !canSignIn) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 text-center shadow-elevated">
          <p className="mb-2 text-200 leading-200 font-semibold uppercase tracking-wider text-link">
            Fabric App
          </p>
          <h2 className="mb-2 text-500 leading-500 font-semibold text-card-foreground">
            Couldn't sign you in
          </h2>
          <p className="text-300 leading-300 text-muted-foreground">{error.message}</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated && canSignIn) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 text-center shadow-elevated">
          <div
            aria-hidden="true"
            className="mx-auto mb-4 grid h-10 w-10 grid-cols-2 gap-0.5"
          >
            <span className="bg-primary" />
            <span className="bg-primary/80" />
            <span className="bg-primary/70" />
            <span className="bg-primary/90" />
          </div>
          <p className="mb-2 text-200 leading-200 font-semibold uppercase tracking-wider text-link">
            Fabric App
          </p>
          <h2 className="mb-2 text-500 leading-500 font-semibold text-card-foreground">
            {error ? "Couldn't sign you in automatically" : 'Welcome back'}
          </h2>
          {error ? (
            <p role="alert" className="mb-4 text-300 leading-300 text-destructive">
              {error.message}
            </p>
          ) : (
            <p className="mb-6 text-300 leading-300 text-muted-foreground">
              Sign in with your Microsoft account to open this Fabric app.
            </p>
          )}
          <button
            type="button"
            className={`${button.large} w-full`}
            disabled={isSigningIn}
            onClick={() => void signIn()}
          >
            {isSigningIn
              ? 'Signing in…'
              : error
                ? 'Try Sign in with Microsoft'
                : 'Sign in with Microsoft'}
          </button>
          {signInError ? (
            <p role="alert" className="mt-4 text-300 leading-300 text-destructive">
              {signInError.message}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-md text-center">
          <h2 className="mb-2 text-500 leading-500 font-semibold text-foreground">
            Sign-in is unavailable
          </h2>
          <p className="mb-4 text-300 leading-300 text-muted-foreground">
            This app requires an authenticated session. Check the authentication
            configuration, then reload to try again.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
