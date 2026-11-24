@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo ERRO: Node.js nao encontrado. Instale Node.js 24 LTS ou mais recente.
  echo https://nodejs.org/
  pause
  exit /b 1
)
if not exist "node_modules\express" (
  echo Instalando dependencias... aguarde a conclusao.
  call npm.cmd install
  if errorlevel 1 (
    echo Falha no npm install. Verifique a conexao com a internet.
    pause
    exit /b 1
  )
)
echo Iniciando sistema em http://127.0.0.1:5000
echo Mantenha esta janela aberta durante o uso.
call npm.cmd start
pause
