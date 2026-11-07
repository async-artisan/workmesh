export type FirstRunDocument = { documentId: string; revisionId: string };

export function prepareFirstRunWorkflow(options: {
  call: (method: string, path: string, body?: unknown) => Promise<unknown>;
  project: { id: string; key: string };
  password: string;
  title: string;
  workflowKey: string;
  roleId: (key: string) => string;
  userId: string;
}): Promise<{
  requirement: { id: string; code: string; version: number };
  published: { definitionRevisionId: string; projectVersion: number };
  understanding: FirstRunDocument;
  prd: FirstRunDocument;
  contract: FirstRunDocument;
  repository: { id: string; identityMode: string };
}>;
