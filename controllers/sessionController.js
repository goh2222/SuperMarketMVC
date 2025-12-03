// sessionController.js
// Handles login, logout, and session checks

exports.home = (req, res) => {
  res.render('index', { user: req.session.user });
};

exports.logout = (req, res) => {
  req.session.destroy(() => res.redirect('/'));
};
