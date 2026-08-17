-- CreateEnum
CREATE TYPE "Role" AS ENUM ('PROFESSOR', 'SUPERVISOR');

-- CreateEnum
CREATE TYPE "KitType" AS ENUM ('MALETA', 'CARRINHO');

-- CreateEnum
CREATE TYPE "KitStatus" AS ENUM ('DISPONIVEL', 'MANUTENCAO', 'INDISPONIVEL', 'DESATIVADO');

-- CreateEnum
CREATE TYPE "NotebookStatus" AS ENUM ('DISPONIVEL', 'RESERVADO', 'EM_USO', 'MANUTENCAO', 'PERDIDO', 'INDISPONIVEL', 'DESATIVADO');

-- CreateEnum
CREATE TYPE "ChargerKitStatus" AS ENUM ('COMPLETO', 'INCOMPLETO', 'MANUTENCAO', 'INDISPONIVEL', 'DESATIVADO');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('SOLICITADA', 'CONFIRMADA', 'RETIRADA', 'EM_USO', 'DEVOLVIDA', 'ENCERRADA', 'CANCELADA', 'NAO_COMPARECEU');

-- CreateEnum
CREATE TYPE "ReservationItemType" AS ENUM ('KIT', 'NOTEBOOK');

-- CreateEnum
CREATE TYPE "IncidentCategory" AS ENUM ('HARDWARE', 'CARREGADOR', 'BATERIA', 'TELA', 'TECLADO', 'TOUCHPAD', 'REDE', 'SISTEMA', 'SOFTWARE', 'DANO_FISICO', 'LIMPEZA', 'ACESSORIO_AUSENTE', 'DEVOLUCAO_INCOMPLETA', 'NOTEBOOK_FALTANTE', 'CARREGADOR_FALTANTE', 'OUTRO');

-- CreateEnum
CREATE TYPE "IncidentSeverity" AS ENUM ('BAIXA', 'MEDIA', 'ALTA', 'CRITICA');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('ABERTA', 'EM_ANALISE', 'EM_MANUTENCAO', 'RESOLVIDA', 'DESCARTADA', 'RECORRENTE');

-- CreateEnum
CREATE TYPE "IncidentTargetType" AS ENUM ('NOTEBOOK', 'KIT', 'CHARGER_KIT', 'RESERVATION');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "whatsapp_opt_in" BOOLEAN NOT NULL DEFAULT false,
    "department" TEXT,
    "role" "Role" NOT NULL DEFAULT 'PROFESSOR',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "last_login_at" TIMESTAMPTZ(3),
    "password_changed_at" TIMESTAMPTZ(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),
    "ip" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_attempts" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kits" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "KitType" NOT NULL,
    "capacity" INTEGER NOT NULL,
    "location" TEXT,
    "description" TEXT,
    "notes" TEXT,
    "status" "KitStatus" NOT NULL DEFAULT 'DISPONIVEL',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "kits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notebooks" (
    "id" TEXT NOT NULL,
    "asset_tag" TEXT NOT NULL,
    "serial_number" TEXT,
    "nickname" TEXT,
    "brand" TEXT,
    "model" TEXT,
    "kit_id" TEXT,
    "status" "NotebookStatus" NOT NULL DEFAULT 'DISPONIVEL',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notebooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "charger_kits" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kit_id" TEXT,
    "total_quantity" INTEGER NOT NULL,
    "available_quantity" INTEGER NOT NULL,
    "status" "ChargerKitStatus" NOT NULL DEFAULT 'COMPLETO',
    "missing_parts" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "charger_kits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservations" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "all_day" BOOLEAN NOT NULL DEFAULT false,
    "purpose" TEXT,
    "class_name" TEXT,
    "subject" TEXT,
    "room" TEXT,
    "requested_notebooks" INTEGER,
    "status" "ReservationStatus" NOT NULL DEFAULT 'CONFIRMADA',
    "teacher_notes" TEXT,
    "supervisor_notes" TEXT,
    "picked_up_at" TIMESTAMPTZ(3),
    "returned_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "cancel_reason" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservation_items" (
    "id" TEXT NOT NULL,
    "reservation_id" TEXT NOT NULL,
    "type" "ReservationItemType" NOT NULL,
    "kit_id" TEXT,
    "notebook_id" TEXT,
    "quantity" INTEGER,
    "resource_key" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "blocking" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reservation_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "target_type" "IncidentTargetType" NOT NULL,
    "notebook_id" TEXT,
    "kit_id" TEXT,
    "charger_kit_id" TEXT,
    "reservation_id" TEXT,
    "reported_by_id" TEXT NOT NULL,
    "assigned_to_id" TEXT,
    "category" "IncidentCategory" NOT NULL,
    "severity" "IncidentSeverity" NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'ABERTA',
    "description" TEXT NOT NULL,
    "resolution" TEXT,
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_attachments" (
    "id" TEXT NOT NULL,
    "incident_id" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "uploaded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incident_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "summary" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by_id" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "whatsapp_contact_logs" (
    "id" TEXT NOT NULL,
    "requester_id" TEXT NOT NULL,
    "target_user_id" TEXT NOT NULL,
    "reservation_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_contact_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_active_idx" ON "users"("role", "active");

-- CreateIndex
CREATE INDEX "users_full_name_idx" ON "users"("full_name");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE INDEX "login_attempts_username_created_at_idx" ON "login_attempts"("username", "created_at");

-- CreateIndex
CREATE INDEX "login_attempts_ip_created_at_idx" ON "login_attempts"("ip", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "kits_code_key" ON "kits"("code");

-- CreateIndex
CREATE INDEX "kits_type_status_idx" ON "kits"("type", "status");

-- CreateIndex
CREATE INDEX "kits_status_idx" ON "kits"("status");

-- CreateIndex
CREATE UNIQUE INDEX "notebooks_asset_tag_key" ON "notebooks"("asset_tag");

-- CreateIndex
CREATE UNIQUE INDEX "notebooks_serial_number_key" ON "notebooks"("serial_number");

-- CreateIndex
CREATE INDEX "notebooks_kit_id_idx" ON "notebooks"("kit_id");

-- CreateIndex
CREATE INDEX "notebooks_status_idx" ON "notebooks"("status");

-- CreateIndex
CREATE UNIQUE INDEX "charger_kits_code_key" ON "charger_kits"("code");

-- CreateIndex
CREATE UNIQUE INDEX "charger_kits_kit_id_key" ON "charger_kits"("kit_id");

-- CreateIndex
CREATE INDEX "charger_kits_status_idx" ON "charger_kits"("status");

-- CreateIndex
CREATE UNIQUE INDEX "reservations_code_key" ON "reservations"("code");

-- CreateIndex
CREATE INDEX "reservations_user_id_date_idx" ON "reservations"("user_id", "date");

-- CreateIndex
CREATE INDEX "reservations_date_status_idx" ON "reservations"("date", "status");

-- CreateIndex
CREATE INDEX "reservations_starts_at_ends_at_idx" ON "reservations"("starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "reservations_status_idx" ON "reservations"("status");

-- CreateIndex
CREATE INDEX "reservation_items_resource_key_blocking_idx" ON "reservation_items"("resource_key", "blocking");

-- CreateIndex
CREATE INDEX "reservation_items_starts_at_ends_at_idx" ON "reservation_items"("starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "reservation_items_kit_id_idx" ON "reservation_items"("kit_id");

-- CreateIndex
CREATE INDEX "reservation_items_notebook_id_idx" ON "reservation_items"("notebook_id");

-- CreateIndex
CREATE UNIQUE INDEX "reservation_items_reservation_id_resource_key_key" ON "reservation_items"("reservation_id", "resource_key");

-- CreateIndex
CREATE UNIQUE INDEX "incidents_code_key" ON "incidents"("code");

-- CreateIndex
CREATE INDEX "incidents_status_severity_idx" ON "incidents"("status", "severity");

-- CreateIndex
CREATE INDEX "incidents_notebook_id_idx" ON "incidents"("notebook_id");

-- CreateIndex
CREATE INDEX "incidents_kit_id_idx" ON "incidents"("kit_id");

-- CreateIndex
CREATE INDEX "incidents_reservation_id_idx" ON "incidents"("reservation_id");

-- CreateIndex
CREATE INDEX "incidents_reported_by_id_idx" ON "incidents"("reported_by_id");

-- CreateIndex
CREATE INDEX "incidents_created_at_idx" ON "incidents"("created_at");

-- CreateIndex
CREATE INDEX "incident_attachments_incident_id_idx" ON "incident_attachments"("incident_id");

-- CreateIndex
CREATE INDEX "audit_logs_entity_entity_id_created_at_idx" ON "audit_logs"("entity", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "whatsapp_contact_logs_requester_id_created_at_idx" ON "whatsapp_contact_logs"("requester_id", "created_at");

-- CreateIndex
CREATE INDEX "whatsapp_contact_logs_created_at_idx" ON "whatsapp_contact_logs"("created_at");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notebooks" ADD CONSTRAINT "notebooks_kit_id_fkey" FOREIGN KEY ("kit_id") REFERENCES "kits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charger_kits" ADD CONSTRAINT "charger_kits_kit_id_fkey" FOREIGN KEY ("kit_id") REFERENCES "kits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_items" ADD CONSTRAINT "reservation_items_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_items" ADD CONSTRAINT "reservation_items_kit_id_fkey" FOREIGN KEY ("kit_id") REFERENCES "kits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_items" ADD CONSTRAINT "reservation_items_notebook_id_fkey" FOREIGN KEY ("notebook_id") REFERENCES "notebooks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_notebook_id_fkey" FOREIGN KEY ("notebook_id") REFERENCES "notebooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_kit_id_fkey" FOREIGN KEY ("kit_id") REFERENCES "kits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_charger_kit_id_fkey" FOREIGN KEY ("charger_kit_id") REFERENCES "charger_kits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_reported_by_id_fkey" FOREIGN KEY ("reported_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_attachments" ADD CONSTRAINT "incident_attachments_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_attachments" ADD CONSTRAINT "incident_attachments_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_contact_logs" ADD CONSTRAINT "whatsapp_contact_logs_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_contact_logs" ADD CONSTRAINT "whatsapp_contact_logs_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_contact_logs" ADD CONSTRAINT "whatsapp_contact_logs_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Garantia de integridade contra reservas conflitantes.
--
-- A checagem na camada de servico existe para produzir mensagens claras, mas
-- duas requisicoes simultaneas poderiam passar por ela ao mesmo tempo. Esta
-- restricao EXCLUDE faz o proprio PostgreSQL recusar qualquer par de itens
-- ativos (blocking = true) do mesmo recurso cujos intervalos se sobreponham.
--
-- Usa uma expressao tstzrange com limite inferior fechado e superior aberto
-- "[)", de modo que uma reserva que termina as 10:00 nao conflita com outra
-- que comeca as 10:00. btree_gist e necessario para combinar o operador "="
-- em texto com o operador de sobreposicao "&&" no mesmo indice GiST.
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "reservation_items"
  ADD CONSTRAINT "reservation_items_no_overlap"
  EXCLUDE USING gist (
    "resource_key" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  ) WHERE ("blocking");
