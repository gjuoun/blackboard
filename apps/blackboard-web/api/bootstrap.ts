import { ChangeBus } from "../lib/change-bus";
import { CommentsStore } from "../lib/comments-store";
import { Db } from "../lib/db/client";
import { Migrations } from "../lib/db/migrate";
import { AgentsRepo } from "../lib/db/repos/agents";
import { CommentsRepo } from "../lib/db/repos/comments";
import { ContentBlocksRepo } from "../lib/db/repos/content-blocks";
import { DocumentsRepo } from "../lib/db/repos/documents";
import { ReadingStateRepo } from "../lib/db/repos/reading-state";
import { Lock } from "../lib/lock";
import { ReadingStateStore } from "../lib/reading-state";
import { SessionsStore } from "../lib/sessions";

/**
 * Every dependency the API and the CLI build, constructed once, in one place, in dependency order.
 *
 * Nothing here is a container: `new X(dep)` is the whole wiring, and a class that needs something new
 * takes it as a constructor argument in this file. The routes never reach for a global — they are
 * handed what they use, so a test can build the same graph against a temp home.
 */
export type Services = ReturnType<typeof bootstrap>;

export function bootstrap() {
  const lock = new Lock();
  const bus = new ChangeBus();

  const db = new Db();
  const agents = new AgentsRepo(db);
  const documents = new DocumentsRepo(db);
  const commentsRepo = new CommentsRepo(db);
  const contentBlocks = new ContentBlocksRepo(db);
  const readingRepo = new ReadingStateRepo(db);

  const comments = new CommentsStore(commentsRepo, contentBlocks, bus);
  const sessions = new SessionsStore(db, documents, comments);
  const reading = new ReadingStateStore(readingRepo);
  const migrations = new Migrations(db, lock);

  return {
    lock,
    bus,
    db,
    agents,
    documents,
    commentsRepo,
    contentBlocks,
    readingRepo,
    comments,
    sessions,
    reading,
    migrations,
  };
}