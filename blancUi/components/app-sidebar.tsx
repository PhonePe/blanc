"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import {
  IconFileTextShield,
  IconChecklist,
  IconSparkles,
  IconSettings,
  IconLogout,
  IconSelector,
  IconPlus,
  type Icon,
} from "@tabler/icons-react";

import { cn } from "@/lib/utils";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/lib/auth-context";

type NavItem = {
  name: string;
  url: string;
  icon: Icon;
};

const workspaceItems: NavItem[] = [
  {
    name: "Assessments",
    url: "/dashboard/assessment/my_assessment",
    icon: IconFileTextShield,
  },
  {
    name: "Under Review",
    url: "/dashboard/assessment/under_review",
    icon: IconChecklist,
  },
  {
    name: "ATM Studio",
    url: "/dashboard/atmstudio",
    icon: IconSparkles,
  },
];

const adminItems: NavItem[] = [
  { name: "Admin Panel", url: "/dashboard/admin", icon: IconSettings },
];

function NavUser({
  user,
}: {
  user: { name: string; email: string; avatar?: string };
}) {
  const router = useRouter();

  const initials =
    user.name
      ?.split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "U";

  const handleLogout = () => {
    try {
      localStorage.removeItem("access_token");
      localStorage.removeItem("refresh_token");
      localStorage.removeItem("user_session");
      localStorage.removeItem("token");
    } catch {
      // ignore storage access errors
    }
    router.push("/login");
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              tooltip={user.name}
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="size-8 rounded-lg">
                <AvatarImage src={user.avatar} alt={user.name} />
                <AvatarFallback className="rounded-lg bg-linear-to-br from-primary/85 to-primary text-primary-foreground text-[11px] font-semibold">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{user.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {user.email}
                </span>
              </div>
              <IconSelector className="ml-auto size-4 text-muted-foreground" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="right"
            align="end"
            sideOffset={8}
            className="min-w-60 rounded-lg p-1"
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm">
                <Avatar className="size-9 rounded-md">
                  <AvatarImage src={user.avatar} alt={user.name} />
                  <AvatarFallback className="rounded-md bg-linear-to-br from-primary/85 to-primary text-primary-foreground text-[11px] font-semibold">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">{user.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {user.email}
                  </span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleLogout}
              className="gap-2 cursor-pointer text-destructive focus:text-destructive"
            >
              <IconLogout className="size-4" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { user, isLoading } = useAuth();
  const pathname = usePathname();

  const isItemActive = (url: string) =>
    pathname === url || (pathname?.startsWith(url + "/") ?? false);

  return (
    <Sidebar collapsible="icon" {...props}>
      {/* Brand */}
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              size="lg"
              tooltip="Blanc · Threat Modeling Studio"
              className="data-[state=open]:bg-sidebar-accent"
            >
              <Link href="/dashboard/assessment/new">
                <span
                  className={cn(
                    "relative flex aspect-square size-8 items-center justify-center overflow-hidden rounded-lg bg-black",
                    "shadow-[0_1px_0_0_rgba(255,255,255,0.06)_inset,0_3px_10px_-3px_rgba(0,0,0,0.45)]",
                    "ring-1 ring-black/80 dark:ring-white/15",
                  )}
                >
                  <Image
                    src="/brand.png"
                    alt="Blanc Threat Modeling Studio"
                    width={32}
                    height={32}
                    priority
                    className="size-full object-cover"
                  />
                </span>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate text-sm font-semibold">
                    Blanc<span className="text-destructive">.</span>
                  </span>
                  <span className="truncate text-[11px] text-muted-foreground">
                    Threat Modeling Studio
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      {/* Content */}
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  tooltip="New Assessment"
                  className="bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:text-primary-foreground focus-visible:bg-primary/90 focus-visible:text-primary-foreground active:bg-primary/90 active:text-primary-foreground data-[active=true]:bg-primary data-[active=true]:text-primary-foreground data-[state=open]:hover:bg-primary/90 data-[state=open]:hover:text-primary-foreground"
                >
                  <Link href="/dashboard/assessment/new">
                    <IconPlus />
                    <span className="font-semibold">New Assessment</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {isLoading
                ? Array.from({ length: 3 }).map((_, i) => (
                    <SidebarMenuItem key={i}>
                      <div className="flex h-8 items-center gap-2 rounded-md px-2">
                        <div className="size-4 animate-pulse rounded bg-muted" />
                        <div className="h-3 w-24 animate-pulse rounded bg-muted" />
                      </div>
                    </SidebarMenuItem>
                  ))
                : workspaceItems.map((item) => {
                    const active = isItemActive(item.url);
                    return (
                      <SidebarMenuItem key={item.name}>
                        <SidebarMenuButton
                          asChild
                          isActive={active}
                          tooltip={item.name}
                        >
                          <Link href={item.url}>
                            <item.icon />
                            <span>{item.name}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {user?.role === "ADMIN" && (
          <SidebarGroup>
            <SidebarGroupLabel>Admin</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminItems.map((item) => {
                  const active = isItemActive(item.url);
                  return (
                    <SidebarMenuItem key={item.name}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        tooltip={item.name}
                      >
                        <Link href={item.url}>
                          <item.icon />
                          <span>{item.name}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      {/* Footer */}
      <SidebarFooter>{user && <NavUser user={user} />}</SidebarFooter>
    </Sidebar>
  );
}
