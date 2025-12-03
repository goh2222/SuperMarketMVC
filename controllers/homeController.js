// homeController.js
// Handles home and static views
exports.index = (req, res) => {
  res.render('index', { user: req.session.user });
};
