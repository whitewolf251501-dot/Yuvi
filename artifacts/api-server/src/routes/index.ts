import { Router, type IRouter } from "express";
import healthRouter from "./health";
import groqRouter from "./groq";

const router: IRouter = Router();

router.use(healthRouter);
router.use(groqRouter);

export default router;
