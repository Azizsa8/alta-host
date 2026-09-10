-- A connection made in demo mode: the connect flow ran and the channel is
-- usable in the product, but no real platform credential was exchanged.
-- Its own column rather than "connected with an empty vault", so every
-- screen can state which kind of connection it is instead of guessing.
ALTER TABLE "SocialChannel" ADD COLUMN "demoConnection" BOOLEAN NOT NULL DEFAULT false;
