import type { Request, Response } from "express";
import type { IStorage } from "../storage";
import type { ProjectDefinition } from "../projects";

export type ProjectContext = {
  project: ProjectDefinition;
  storage: IStorage;
};

export type ProjectHandler = (ctx: ProjectContext, req: Request, res: Response) => unknown | Promise<unknown>;

export type WithProject = (handler: ProjectHandler) => (req: Request, res: Response) => unknown | Promise<unknown>;
