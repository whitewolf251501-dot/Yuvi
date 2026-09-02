import { Router, type IRouter } from "express";
import healthRouter from "./health";
import githubMemoryRouter from "./github-memory";

const router: IRouter = Router();

router.use(healthRouter);
router.use(githubMemoryRouter);

export default router;
