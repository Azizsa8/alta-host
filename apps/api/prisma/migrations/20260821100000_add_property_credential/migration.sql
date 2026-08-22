CREATE TABLE "PropertyCredential" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "lastRotatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAccessedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PropertyCredential_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PropertyCredential_propertyId_key_key" ON "PropertyCredential"("propertyId", "key");
CREATE INDEX "PropertyCredential_propertyId_idx" ON "PropertyCredential"("propertyId");
ALTER TABLE "PropertyCredential" ADD CONSTRAINT "PropertyCredential_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
