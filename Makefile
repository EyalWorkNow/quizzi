COMPOSE_FILE=infra/docker-compose.yml

up:
	docker compose -f $(COMPOSE_FILE) up --build -d

down:
	docker compose -f $(COMPOSE_FILE) down

migrate:
	docker compose -f $(COMPOSE_FILE) exec backend alembic upgrade head

seed:
	docker compose -f $(COMPOSE_FILE) exec backend python scripts/seed.py

test:
	docker compose -f $(COMPOSE_FILE) exec backend pytest -q
	sleep 1
	docker compose -f $(COMPOSE_FILE) exec frontend pnpm test:smoke

smoke:
	docker compose -f $(COMPOSE_FILE) exec backend python scripts/smoke_demo.py
