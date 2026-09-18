/**
 * Access-link query keys.
 *
 * They live in their own module (rather than beside the access-link hooks) so
 * the authoring cache-effects layer can name access-link projections without
 * importing the access-link query hooks back — one direction only.
 */
export const accessLinkKeys = {
  root: ["assessment-access-links"] as const,
  overview: (examId: string) => [...accessLinkKeys.root, "overview", examId] as const,
  link: (linkId: string) => [...accessLinkKeys.root, "link", linkId] as const,
  members: (linkId: string) => [...accessLinkKeys.root, "members", linkId] as const,
  activity: (linkId: string) => [...accessLinkKeys.root, "activity", linkId] as const,
  public: (linkId: string) => [...accessLinkKeys.root, "public", linkId] as const,
};
