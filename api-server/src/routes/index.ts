import { Router, type IRouter } from "express";
import healthRouter from "./health";
import aiProxyRouter from "./ai-proxy";
import { terminalRouter } from "./terminal";
import dbRouter from "./db";
import githubRouter from "./github";
import searchRouter from "./search";
import previewRouter from "./preview";
import { termuxRouter } from "./termux";

const router: IRouter = Router();

router.use(healthRouter);
router.use(aiProxyRouter);
router.use(terminalRouter);
router.use(dbRouter);
router.use(githubRouter);
router.use(searchRouter);
router.use(previewRouter);
router.use(termuxRouter);

export default router;
