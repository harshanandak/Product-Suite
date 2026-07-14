import { useClerk, useUser } from "@clerk/clerk-react";
import { LogOut } from "lucide-react";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@product-suite/ui";

import { USE_FIXTURES } from "@/fixtures-mode";

function initialsFrom(label: string): string {
  const letters = label
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return letters || "?";
}

/**
 * Presentational user menu (DESIGN §2): a shadcn DropdownMenu, NOT Clerk's
 * `UserButton` (which renders outside our oklch token system). Pure props so both
 * the real Clerk-backed menu and the DEV-ONLY preview stub share one surface.
 */
function UserMenuView({
  name,
  email,
  imageUrl,
  onSignOut,
}: Readonly<{
  name: string;
  email?: string;
  imageUrl?: string;
  onSignOut: () => void;
}>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full"
          aria-label="Open user menu"
        >
          <Avatar className="size-7">
            {imageUrl ? <AvatarImage src={imageUrl} alt="" /> : null}
            <AvatarFallback>{initialsFrom(name)}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <span className="block truncate text-sm font-medium">{name}</span>
          {email ? (
            <span className="block truncate text-xs font-normal text-muted-foreground">
              {email}
            </span>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onSignOut}>
          <LogOut className="size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Avatar + identity from the Clerk session; sign-out via the Clerk client. */
function ClerkUserMenu() {
  const { user } = useUser();
  const { signOut } = useClerk();

  const email = user?.primaryEmailAddress?.emailAddress;
  const name = user?.fullName || email || "Account";

  return (
    <UserMenuView
      name={name}
      email={email}
      imageUrl={user?.imageUrl}
      onSignOut={() => {
        signOut({ redirectUrl: "/sign-in" }).catch(() => {});
      }}
    />
  );
}

/**
 * DEV-ONLY preview stub — a static identity with an inert sign-out. Used in
 * fixtures/preview mode where there is NO `ClerkProvider`, so it must NOT call any
 * Clerk hook. Reached only through the {@link USE_FIXTURES} branch below, which is
 * dead-code-eliminated from the production bundle.
 */
function PreviewUserMenu() {
  return (
    <UserMenuView
      name="Preview user"
      email="preview@fixtures.local"
      onSignOut={() => {}}
    />
  );
}

/**
 * Token-native user menu (DESIGN §2). Renders the Clerk-backed menu normally; in
 * DEV-ONLY fixtures/preview mode it renders a Clerk-free stub instead (no session
 * exists). `USE_FIXTURES` folds to `false` in production, so the stub branch is
 * stripped from the shipped bundle.
 */
export function UserMenu() {
  if (USE_FIXTURES) return <PreviewUserMenu />;
  return <ClerkUserMenu />;
}
