// 1. Importar as bibliotecas
const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const jwt = require('jsonwebtoken');

// 2. Configurações da API
const app = express();
const PORT = process.env.PORT || 3000;
const SPREADSHEET_ID = '105-AqvOHRe-CiB4oODYL26raXLOVBfB0jI7Z3Pm_viM';
const JWT_SECRET = 'seu-segredo-super-secreto-pode-ser-qualquer-coisa';

// Lista de sites (origens) que podem aceder a esta API
const allowedOrigins = [
  'https://luisbastosgit.github.io',
];

// Configuração final do CORS
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.some(allowedOrigin => origin.startsWith(allowedOrigin))) {
      callback(null, true);
    } else {
      callback(new Error('A política de CORS para este site não permite o acesso.'));
    }
  }
}));

app.use(express.json());

// =================================================================
// FUNÇÕES AUXILIARES E DE AUTENTICAÇÃO
// =================================================================

function columnIndexToLetter(index) {
  let temp, letter = '';
  while (index >= 0) {
    temp = index % 26;
    letter = String.fromCharCode(temp + 65) + letter;
    index = Math.floor(index / 26) - 1;
  }
  return letter;
}

function calculateAverage(grades) {
  const validGrades = grades
    .map(grade => parseFloat(String(grade || '0').replace(',', '.')))
    .filter(grade => grade > 0);

  if (validGrades.length === 0) return '';
  
  const sum = validGrades.reduce((acc, grade) => acc + grade, 0);
  const average = sum / validGrades.length;
  
  return average.toFixed(2).replace('.', ',');
}

async function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: 'https://www.googleapis.com/auth/spreadsheets',
  });
  const client = await auth.getClient();
  const googleSheets = google.sheets({ version: 'v4', auth: client });
  return { googleSheets };
}

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (token == null) return res.status(401).json({ success: false, message: "Acesso negado. Token não fornecido." });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ success: false, message: "Token inválido ou expirado." });
    req.user = user;
    next();
  });
};

// =================================================================
// ENDPOINTS DA API
// =================================================================

app.get('/', (req, res) => {
  res.json({ message: "API do Sistema de Estágios está online!" });
});

app.post('/login', async (req, res) => {
  console.log('Recebida requisição de login...');
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email e senha são obrigatórios.' });
    }

    const { googleSheets } = await getAuth();
    const usersSheet = await googleSheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: '_USUARIOS!A:C',
    });
    const users = usersSheet.data.values || [];
    let userFound = null;
    for (let i = 1; i < users.length; i++) {
      const [nome, userEmail, userPassword] = users[i];
      if (userEmail && userPassword && userEmail.toLowerCase() === email.toLowerCase() && userPassword === password) {
        userFound = { nome, email: userEmail };
        break;
      }
    }

    if (userFound) {
      const accessToken = jwt.sign(userFound, JWT_SECRET, { expiresIn: '6h' });
      console.log(`Login bem-sucedido para: ${userFound.email}`);
      res.json({ success: true, message: 'Login bem-sucedido!', user: userFound, token: accessToken });
    } else {
      console.log(`Tentativa de login falhou para: ${email}`);
      res.status(401).json({ success: false, message: 'Email ou senha inválidos.' });
    }

  } catch (error) {
    console.error('ERRO NO ENDPOINT DE LOGIN:', error);
    res.status(500).json({ success: false, message: 'Ocorreu um erro no servidor.' });
  }
});

app.get('/filter-options', async (req, res) => {
  console.log('A obter opções de filtro...');
  try {
    const { googleSheets } = await getAuth();
    const sheetData = await googleSheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Página1!A:Z', // Otimizado para ler apenas colunas relevantes
    });

    const rows = sheetData.data.values || [];
    const headers = rows.shift();
    if (!headers) throw new Error("Cabeçalhos não encontrados na planilha.");

    const colIndexes = {
      status: headers.indexOf('statusPreenchimento'),
      curso: headers.indexOf('curso'),
      orientador: headers.indexOf('nome-orientador'),
      turma: headers.indexOf('turma-fase'),
    };

    const getUniqueValues = (index) => {
      if (index === -1) return [];
      const values = rows.map(row => row[index]).filter(Boolean);
      return [...new Set(values)].sort();
    };

    const options = {
      status: getUniqueValues(colIndexes.status),
      cursos: getUniqueValues(colIndexes.curso),
      orientadores: getUniqueValues(colIndexes.orientador),
      turmas: getUniqueValues(colIndexes.turma),
    };

    res.json({ success: true, data: options });

  } catch (error) {
    console.error('ERRO AO OBTER OPÇÕES DE FILTRO:', error);
    res.status(500).json({ success: false, message: 'Ocorreu um erro no servidor ao obter opções de filtro.' });
  }
});


app.post('/student-data', authenticateToken, async (req, res) => {
  console.log(`Usuário '${req.user.nome}' está a procurar dados de alunos...`);
  try {
    const filters = req.body;
    const { googleSheets } = await getAuth();
    
    const studentSheet = await googleSheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Página1',
    });

    const rows = studentSheet.data.values || [];
    const headers = rows.shift();
    
    let allData = rows.map(row => {
        const rowObj = {};
        headers.forEach((header, index) => {
            rowObj[header] = row[index];
        });
        return rowObj;
    });

    let filteredData = allData;
    if (filters.status) filteredData = filteredData.filter(row => row.statusPreenchimento === filters.status);
    if (filters.curso) filteredData = filteredData.filter(row => row.curso === filters.curso);
    if (filters.orientador) filteredData = filteredData.filter(row => row['nome-orientador'] === filters.orientador);
    if (filters.turma) filteredData = filteredData.filter(row => row['turma-fase'] === filters.turma);
    if (filters.nome) filteredData = filteredData.filter(row => row['nome-completo'] && row['nome-completo'].toLowerCase().includes(filters.nome.toLowerCase()));
    if (filters.ano) filteredData = filteredData.filter(row => row.matricula && row.matricula.startsWith(filters.ano));
    if (filters.cpf) filteredData = filteredData.filter(row => row.cpf && row.cpf.replace(/\D/g, '').includes(filters.cpf.replace(/\D/g, '')));
    
    const stats = {
        total: filteredData.length,
        completos: filteredData.filter(row => row.statusPreenchimento && row.statusPreenchimento.trim().toUpperCase() === 'CONCLUÍDO').length,
        pendentes: filteredData.filter(row => row.statusPreenchimento && row.statusPreenchimento.trim().toUpperCase() === 'ALUNO').length
    };

    console.log(`Encontrados ${stats.total} registos.`);
    res.json({ success: true, data: filteredData, stats: stats });

  } catch (error) {
      console.error('ERRO AO PROCURAR DADOS DOS ALUNOS:', error);
      res.status(500).json({ success: false, message: 'Ocorreu um erro no servidor ao procurar dados.' });
  }
});

app.post('/update-grades', authenticateToken, async (req, res) => {
  console.log(`Usuário '${req.user.nome}' está a tentar atualizar notas...`);
  try {
    const { idRegistro, notaSupervisor, notaRelatorio, notaDefesa, observacoes } = req.body;
    const { googleSheets } = await getAuth();
    
    const mediaFinal = calculateAverage([notaSupervisor, notaRelatorio, notaDefesa]);

    const studentSheet = await googleSheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Página1',
    });
    
    const rows = studentSheet.data.values || [];
    const headers = rows[0];
    
    const columnIndexes = {
        idRegistro: headers.indexOf('idRegistro'),
        orientador: headers.indexOf('nome-orientador'),
        notaSupervisor: headers.indexOf('Nota Supervisor'),
        notaRelatorio: headers.indexOf('Nota Relatório'),
        notaDefesa: headers.indexOf('Nota da Defesa'),
        media: headers.indexOf('Média'),
        observacoes: headers.indexOf('Observações')
    };

    for (const [key, value] of Object.entries(columnIndexes)) {
        if (value === -1) {
            return res.status(500).json({ success: false, message: `Erro de configuração: A coluna "${key}" não foi encontrada na planilha.` });
        }
    }

    let targetRowIndex = -1;
    for(let i = 1; i < rows.length; i++) {
        if(rows[i][columnIndexes.idRegistro] && rows[i][columnIndexes.idRegistro].trim() === idRegistro.trim()) {
            targetRowIndex = i;
            break;
        }
    }

    if (targetRowIndex === -1) {
        return res.status(404).json({ success: false, message: "Aluno com o ID fornecido não encontrado." });
    }

    const orientadorDoAluno = rows[targetRowIndex][columnIndexes.orientador];
    if (orientadorDoAluno.trim().toUpperCase() !== req.user.nome.trim().toUpperCase()) {
        return res.status(403).json({ success: false, message: "Acesso negado: Você não é o orientador deste aluno." });
    }

    const notaSupCol = columnIndexToLetter(columnIndexes.notaSupervisor);
    const notaRelCol = columnIndexToLetter(columnIndexes.notaRelatorio);
    const notaDefCol = columnIndexToLetter(columnIndexes.notaDefesa);
    const mediaCol = columnIndexToLetter(columnIndexes.media);
    const obsCol = columnIndexToLetter(columnIndexes.observacoes);
    const rowNumber = targetRowIndex + 1;

    await googleSheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: {
            valueInputOption: 'USER_ENTERED',
            data: [
                { range: `Página1!${notaSupCol}${rowNumber}`, values: [[notaSupervisor]] },
                { range: `Página1!${notaRelCol}${rowNumber}`, values: [[notaRelatorio]] },
                { range: `Página1!${notaDefCol}${rowNumber}`, values: [[notaDefesa]] },
                { range: `Página1!${mediaCol}${rowNumber}`, values: [[mediaFinal]] },
                { range: `Página1!${obsCol}${rowNumber}`, values: [[observacoes]] },
            ]
        }
    });

    console.log(`Notas do registo ${idRegistro} atualizadas com sucesso.`);
    res.json({ success: true, message: "Notas salvas com sucesso!" });

  } catch (error) {
    console.error('ERRO AO ATUALIZAR NOTAS:', error);
    res.status(500).json({ success: false, message: 'Ocorreu um erro no servidor ao salvar as notas.' });
  }
});

app.post('/complete-registration', async (req, res) => {
  console.log('A receber dados do formulário da empresa...');
  try {
      const { idRegistro, ...companyData } = req.body;
      if (!idRegistro) {
          return res.status(400).json({ success: false, message: "ID do registo não fornecido." });
      }

      const { googleSheets } = await getAuth();
      const sheetData = await googleSheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID,
          range: 'Página1',
      });

      const rows = sheetData.data.values || [];
      const headers = rows[0];
      const idRegistroColIndex = headers.indexOf('idRegistro');

      let targetRowIndex = -1;
      for (let i = 1; i < rows.length; i++) {
          if (rows[i][idRegistroColIndex] && rows[i][idRegistroColIndex].trim() === idRegistro.trim()) {
              targetRowIndex = i;
              break;
          }
      }

      if (targetRowIndex === -1) {
          return res.status(404).json({ success: false, message: "Registo de estágio não encontrado." });
      }

      const rowNumber = targetRowIndex + 1;
      const updates = [];
      
      // Mapeia os dados recebidos para as colunas corretas
      for (const [key, value] of Object.entries(companyData)) {
          const colIndex = headers.indexOf(key);
          if (colIndex !== -1) {
              const colLetter = columnIndexToLetter(colIndex);
              updates.push({
                  range: `Página1!${colLetter}${rowNumber}`,
                  values: [[value]]
              });
          }
      }

      // Adiciona a atualização do status
      const statusColIndex = headers.indexOf('statusPreenchimento');
      if (statusColIndex !== -1) {
          const statusColLetter = columnIndexToLetter(statusColIndex);
          updates.push({
              range: `Página1!${statusColLetter}${rowNumber}`,
              values: [['Concluído']]
          });
      }

      if (updates.length > 0) {
          await googleSheets.spreadsheets.values.batchUpdate({
              spreadsheetId: SPREADSHEET_ID,
              resource: {
                  valueInputOption: 'USER_ENTERED',
                  data: updates
              }
          });
      }

      console.log(`Registo ${idRegistro} atualizado com sucesso pela empresa.`);
      res.json({ success: true, message: "Dados enviados com sucesso! Obrigado." });

  } catch (error) {
      console.error('ERRO NO REGISTO DA EMPRESA:', error);
      res.status(500).json({ success: false, message: "Ocorreu um erro no servidor." });
  }
});


// Inicia o servidor da API
app.listen(PORT, () => {
  console.log(`🚀 Servidor a rodar na porta ${PORT}`);
});