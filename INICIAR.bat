@echo off
rem Abre o painel RELATORIO 146 nesta maquina (http://localhost:3106), lendo o DATA WAREHOUSE
rem com o ENV do agente (ou do Inventario) que ja existe aqui. So esta maquina acessa.
cd /d "%~dp0web"
if not exist node_modules call npm install --no-audit --no-fund
start "" http://localhost:3106
node servidor_local.js
pause
