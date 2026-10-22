import { Redirect, Route, Switch } from 'wouter';
import { CatalogPage } from './pages/CatalogPage';
import { HomePage } from './pages/HomePage';

export function App() {
  return (
    <Switch>
      <Route path="/catalog" component={CatalogPage} />
      <Route path="/plans/:id/3d">{({ id }) => <HomePage id={id} />}</Route>
      <Route>
        <Redirect to="/catalog" replace />
      </Route>
    </Switch>
  );
}
