export const ROLES = ["owner", "admin", "designer", "editor", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export type Action =
  | "workspace.manage"
  | "workspace.billing"
  | "members.manage"
  | "keys.manage"
  | "project.create"
  | "project.manage"
  | "sources.manage"
  | "channels.manage"
  | "designsystem.manage"
  | "template.manage"
  | "post.create"
  | "post.publish"
  | "view";

const GRANTS: Record<Role, Action[]> = {
  owner: ["workspace.manage", "workspace.billing", "members.manage", "keys.manage", "project.create", "project.manage", "sources.manage", "channels.manage", "designsystem.manage", "template.manage", "post.create", "post.publish", "view"],
  admin: ["members.manage", "keys.manage", "project.create", "project.manage", "sources.manage", "channels.manage", "designsystem.manage", "template.manage", "post.create", "post.publish", "view"],
  designer: ["designsystem.manage", "template.manage", "post.create", "post.publish", "view"],
  editor: ["post.create", "post.publish", "view"],
  viewer: ["view"],
};

export function can(role: Role | null | undefined, action: Action): boolean {
  return !!role && GRANTS[role].includes(action);
}

export function roleRank(role: Role): number {
  return ROLES.length - ROLES.indexOf(role);
}

/** A project role can narrow, never widen, the workspace role. */
export function effectiveRole(workspaceRole: Role, projectRole?: Role | null): Role {
  if (!projectRole) return workspaceRole;
  return roleRank(projectRole) < roleRank(workspaceRole) ? projectRole : workspaceRole;
}
